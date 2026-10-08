import { GameError } from "./errors";

export interface AccessEnv {
  DB: D1Database;
  DEMO_ACCESS_CODE?: string;
  GENERATION_ENABLED?: string;
  GENERATION_DAILY_LIMIT?: string;
  GENERATION_TOTAL_LIMIT?: string;
  GENERATION_SESSION_LIMIT?: string;
  GENERATION_IP_LIMIT?: string;
}

export const ACCESS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS access_sessions (
    id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS access_attempts (
    bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS generation_requests (
    job_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS generation_created ON generation_requests(created_at)`,
  `CREATE INDEX IF NOT EXISTS generation_session ON generation_requests(session_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS generation_ip ON generation_requests(ip_hash, created_at)`,
];

const COOKIE = "burn_rate_session";
const SESSION_SECONDS = 7 * 86400;

export async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalHash(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < 64; i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}

export function generationEnabled(env: AccessEnv): boolean {
  return Boolean(env.DEMO_ACCESS_CODE) && env.GENERATION_ENABLED === "true";
}

export function assertGenerationEnabled(env: AccessEnv): void {
  if (!generationEnabled(env)) throw new GameError("New generations are paused. You can still explore completed rounds.", 503);
}

function limit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? Math.min(parsed, 1000) : fallback;
}

export function generationLimits(env: AccessEnv) {
  return {
    daily: limit(env.GENERATION_DAILY_LIMIT, 20),
    total: limit(env.GENERATION_TOTAL_LIMIT, 50),
    session: limit(env.GENERATION_SESSION_LIMIT, 3),
    ip: limit(env.GENERATION_IP_LIMIT, 6),
  };
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new GameError("Open Burn Rate directly to make changes.", 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new GameError("Send JSON to this endpoint.", 415);
  }
}

async function ipHash(env: AccessEnv, request: Request): Promise<string> {
  // CF-Connecting-IP is supplied by Cloudflare, not the untrusted forwarded headers.
  return hash(`${env.DEMO_ACCESS_CODE ?? "disabled"}:ip:${request.headers.get("cf-connecting-ip") ?? "local"}`);
}

export async function sessionFor(env: AccessEnv, request: Request): Promise<string | null> {
  if (!env.DEMO_ACCESS_CODE) return null;
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const id = await hash(token);
  const row = await env.DB.prepare("SELECT code_hash FROM access_sessions WHERE id = ? AND expires_at > ?")
    .bind(id, Date.now()).first<{ code_hash: string }>();
  if (!row || !equalHash(row.code_hash, await hash(env.DEMO_ACCESS_CODE))) return null;
  return id;
}

export async function requireSession(env: AccessEnv, request: Request): Promise<string> {
  const session = await sessionFor(env, request);
  if (!session) throw new GameError("Enter your demo invite code before posting a job or choosing a winner.", 401);
  return session;
}

export async function signIn(env: AccessEnv, request: Request, code: unknown): Promise<string> {
  if (!env.DEMO_ACCESS_CODE) throw new GameError("Demo access has not been configured.", 503);
  const now = Date.now();
  const bucket = `${await ipHash(env, request)}:${Math.floor(now / 900000)}`;
  const result = await env.DB.prepare(`INSERT INTO access_attempts (bucket, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 WHERE attempts < 5`)
    .bind(bucket, now + 900000).run();
  if (result.meta.changes !== 1) throw new GameError("Too many access attempts. Try again in 15 minutes.", 429);
  const supplied = typeof code === "string" && code.length <= 256 ? code.trim() : "";
  if (!equalHash(await hash(supplied), await hash(env.DEMO_ACCESS_CODE))) throw new GameError("That invite code didn't match.", 401);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO access_sessions (id, code_hash, expires_at) VALUES (?, ?, ?)")
    .bind(await hash(token), await hash(env.DEMO_ACCESS_CODE), now + SESSION_SECONDS * 1000).run();
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}

export async function signOut(env: AccessEnv, request: Request): Promise<string> {
  const id = await sessionFor(env, request);
  if (id) await env.DB.prepare("DELETE FROM access_sessions WHERE id = ?").bind(id).run();
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}

export async function assertOwner(env: AccessEnv, jobId: string, sessionId: string): Promise<void> {
  const job = await env.DB.prepare("SELECT owner_session_id FROM jobs WHERE id = ?").bind(jobId).first<{ owner_session_id: string | null }>();
  if (!job) throw new GameError("That job isn't on the board.", 404);
  if (job.owner_session_id !== sessionId) throw new GameError("Only the browser that posted this job can authorize it or choose its winner.", 403);
}

export async function reserveGeneration(env: AccessEnv, request: Request, sessionId: string, jobId: string): Promise<void> {
  assertGenerationEnabled(env);
  const limits = generationLimits(env);
  const now = Date.now();
  const day = now - (now % 86400000);
  const ip = await ipHash(env, request);
  // One conditional INSERT is atomic across all Worker instances. Failed/abandoned
  // requests retain their reservation so retries cannot turn into unbounded spend.
  const result = await env.DB.prepare(`INSERT INTO generation_requests (job_id, session_id, ip_hash, created_at)
    SELECT ?, ?, ?, ? WHERE
    (SELECT COUNT(*) FROM generation_requests) < ? AND
    (SELECT COUNT(*) FROM generation_requests WHERE created_at >= ?) < ? AND
    (SELECT COUNT(*) FROM generation_requests WHERE session_id = ? AND created_at >= ?) < ? AND
    (SELECT COUNT(*) FROM generation_requests WHERE ip_hash = ? AND created_at >= ?) < ? AND
    NOT EXISTS (SELECT 1 FROM generation_requests WHERE created_at > ?) AND
    NOT EXISTS (SELECT 1 FROM jobs WHERE status = 'casting' AND created_at > ?)`)
    .bind(jobId, sessionId, ip, now, limits.total, day, limits.daily, sessionId, day, limits.session, ip, day, limits.ip,
      now - 30000, new Date(now - 120000).toISOString()).run();
  if (result.meta.changes !== 1) throw new GameError("The demo limit is reached or another round is being made. Try later, or explore the public rounds.", 429);
}
