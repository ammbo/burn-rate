import { GameError } from "./errors";

export type AccessEnv = Pick<Env, "DB"> & Partial<Pick<Env, "EMAIL">> & {
  EMAIL_FROM?: string;
  AUTH_SECRET?: string;
  APP_ORIGIN?: string;
  GENERATION_ACCOUNT_LIMIT?: string;
  DEMO_ACCESS_CODE?: string;
  GENERATION_ENABLED?: string;
  GENERATION_DAILY_LIMIT?: string;
  GENERATION_TOTAL_LIMIT?: string;
  GENERATION_SESSION_LIMIT?: string;
  GENERATION_IP_LIMIT?: string;
};

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
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_links (
    token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, browser_hash TEXT NOT NULL, expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_requests (
    id TEXT PRIMARY KEY, email_hash TEXT NOT NULL, ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS email_requests_created ON email_requests(created_at)`,
  `CREATE INDEX IF NOT EXISTS email_requests_email ON email_requests(email_hash, created_at)`,
  `CREATE INDEX IF NOT EXISTS email_requests_ip ON email_requests(ip_hash, created_at)`,
];

const COOKIE = "burn_rate_session";
const SESSION_SECONDS = 7 * 86400;
const LOGIN_COOKIE = "burn_rate_login";
const LOGIN_SECONDS = 15 * 60;

export function emailConfigured(env: AccessEnv): boolean {
  if (!env.EMAIL || !env.EMAIL_FROM || !env.AUTH_SECRET || env.AUTH_SECRET.length < 32 || !env.APP_ORIGIN) return false;
  try {
    const origin = new URL(env.APP_ORIGIN);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    return (origin.protocol === "https:" || (local && origin.protocol === "http:")) &&
      origin.pathname === "/" && !origin.search && !origin.hash && !origin.username && !origin.password;
  } catch { return false; }
}

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
  return emailConfigured(env) && env.GENERATION_ENABLED === "true";
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
    account: limit(env.GENERATION_ACCOUNT_LIMIT ?? env.GENERATION_SESSION_LIMIT, 3),
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
  // Retain the existing salt during the invite migration so network allowance
  // already consumed today cannot be reset by the account rollout.
  return hash(`${env.DEMO_ACCESS_CODE ?? env.AUTH_SECRET ?? "disabled"}:ip:${request.headers.get("cf-connecting-ip") ?? "local"}`);
}

function cookieToken(request: Request, name: string): string | null {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookie(request: Request, name: string, token: string, seconds: number, sameSite = "Strict"): string {
  return `${name}=${token}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${seconds}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}

async function readSession(env: AccessEnv, request: Request) {
  const token = cookieToken(request, COOKIE);
  if (!token) return null;
  const id = await hash(token);
  const row = await env.DB.prepare(`SELECT s.code_hash, s.user_id, a.email FROM access_sessions s
    LEFT JOIN accounts a ON a.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`)
    .bind(id, Date.now()).first<{ code_hash: string; user_id: string | null; email: string | null }>();
  if (!row) return null;
  if (row.user_id && row.email) return { id, principal: row.user_id, email: row.email };
  // Previously issued invite sessions can still finish their existing rounds.
  if (env.DEMO_ACCESS_CODE && equalHash(row.code_hash, await hash(env.DEMO_ACCESS_CODE))) return { id, principal: id, email: null };
  return null;
}

export async function sessionFor(env: AccessEnv, request: Request): Promise<string | null> {
  return (await readSession(env, request))?.principal ?? null;
}

export async function accountView(env: AccessEnv, request: Request) {
  const session = await readSession(env, request);
  return { authenticated: Boolean(session?.email), email: session?.email ?? null };
}

export async function requireAccount(env: AccessEnv, request: Request): Promise<string> {
  const session = await readSession(env, request);
  if (!session?.email) throw new GameError("Sign in by email before starting your project.", 401);
  return session.principal;
}

export async function requireSession(env: AccessEnv, request: Request): Promise<string> {
  const session = await sessionFor(env, request);
  if (!session) throw new GameError("Sign in by email to authorize this project or choose its winner.", 401);
  return session;
}

export async function requestSignIn(env: AccessEnv, request: Request, input: unknown): Promise<string> {
  if (!emailConfigured(env)) throw new GameError("Email sign-in is unavailable right now. Your draft is still here.", 503);
  const email = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(email)) {
    throw new GameError("Enter a valid email address.", 400);
  }
  const now = Date.now();
  const emailHash = await hash(`${env.AUTH_SECRET}:email:${email}`);
  const ip = await ipHash(env, request);
  // Reserve sends atomically, including failures. Account creation happens only
  // after the recipient verifies the link; every address gets the same response.
  const reserved = await env.DB.prepare(`INSERT INTO email_requests (id, email_hash, ip_hash, created_at)
    SELECT ?, ?, ?, ? WHERE
    (SELECT COUNT(*) FROM email_requests WHERE created_at > ?) < 100 AND
    (SELECT COUNT(*) FROM email_requests WHERE ip_hash = ? AND created_at > ?) < 5 AND
    (SELECT COUNT(*) FROM email_requests WHERE email_hash = ? AND created_at > ?) < 3 AND
    NOT EXISTS (SELECT 1 FROM email_requests WHERE email_hash = ? AND created_at > ?)`)
    .bind(crypto.randomUUID(), emailHash, ip, now, now - 86400000, ip, now - 900000, emailHash, now - 900000, emailHash, now - 60000).run();
  if (reserved.meta.changes !== 1) throw new GameError("Too many sign-in emails requested. Wait a few minutes before trying again.", 429);
  const token = randomToken();
  const browser = cookieToken(request, LOGIN_COOKIE) ?? randomToken();
  const tokenHash = await hash(token);
  await env.DB.prepare("INSERT INTO login_links (token_hash, email, browser_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(tokenHash, email, await hash(browser), now + LOGIN_SECONDS * 1000).run();
  // Fragments stay out of HTTP requests, referrers, and server access logs.
  const link = `${new URL(env.APP_ORIGIN!).origin}/#/sign-in/${token}`;
  try {
    await env.EMAIL!.send({
      from: { email: env.EMAIL_FROM!, name: "Burn Rate" }, to: email,
      subject: "Sign in to Burn Rate",
      text: `Sign in to Burn Rate: ${link}\n\nOpen this link in the browser where you requested it, then click Sign in. It expires in 15 minutes and works once. Your project draft will be waiting. If you didn't request this email, ignore it.`,
      html: `<h1>Your project is waiting.</h1><p><a href="${link}">Sign in to Burn Rate</a></p><p>Open this link in the browser where you requested it, then click Sign in. It expires in 15 minutes and works once.</p><p>If you didn't request this email, ignore it.</p>`,
    });
  } catch {
    await env.DB.prepare("DELETE FROM login_links WHERE token_hash = ?").bind(tokenHash).run();
    // Provider errors can contain recipient addresses. Do not log them.
    throw new GameError("The sign-in email couldn't be sent. Your draft is saved; please try again later.", 503);
  }
  return cookie(request, LOGIN_COOKIE, browser, LOGIN_SECONDS, "Lax");
}

export async function confirmSignIn(env: AccessEnv, request: Request, input: unknown): Promise<string[]> {
  const token = typeof input === "string" && /^[a-f0-9]{64}$/.test(input) ? input : null;
  const browser = cookieToken(request, LOGIN_COOKIE);
  if (!token || !browser) throw new GameError("Request a new sign-in link in this browser, then open it here.", 401);
  // DELETE RETURNING consumes a link once, even with concurrent confirmations.
  const link = await env.DB.prepare("DELETE FROM login_links WHERE token_hash = ? AND browser_hash = ? AND expires_at > ? RETURNING email")
    .bind(await hash(token), await hash(browser), Date.now()).first<{ email: string }>();
  if (!link) throw new GameError("This sign-in link has expired or was already used. Request a new one.", 401);
  const previous = await readSession(env, request);
  await env.DB.prepare("INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING")
    .bind(crypto.randomUUID(), link.email, Date.now()).run();
  const account = await env.DB.prepare("SELECT id FROM accounts WHERE email = ?").bind(link.email).first<{ id: string }>();
  if (!account) throw new GameError("Sign-in couldn't be completed. Request a new link.", 503);
  const sessionToken = randomToken();
  const statements = [env.DB.prepare("INSERT INTO access_sessions (id, code_hash, expires_at, user_id) VALUES (?, '', ?, ?)")
    .bind(await hash(sessionToken), Date.now() + SESSION_SECONDS * 1000, account.id)];
  if (previous) {
    statements.push(env.DB.prepare("DELETE FROM access_sessions WHERE id = ?").bind(previous.id));
    if (!previous.email) {
      // Claim only rounds whose original, still-valid cookie is present.
      statements.push(env.DB.prepare("UPDATE jobs SET owner_session_id = ? WHERE owner_session_id = ?").bind(account.id, previous.id));
      statements.push(env.DB.prepare("UPDATE generation_requests SET session_id = ? WHERE session_id = ?").bind(account.id, previous.id));
    }
  }
  await env.DB.batch(statements);
  return [cookie(request, COOKIE, sessionToken, SESSION_SECONDS), cookie(request, LOGIN_COOKIE, "", 0, "Lax")];
}

export async function signOut(env: AccessEnv, request: Request): Promise<string> {
  const session = await readSession(env, request);
  if (session) await env.DB.prepare("DELETE FROM access_sessions WHERE id = ?").bind(session.id).run();
  return cookie(request, COOKIE, "", 0);
}

export async function assertOwner(env: AccessEnv, jobId: string, sessionId: string): Promise<void> {
  const job = await env.DB.prepare("SELECT owner_session_id FROM jobs WHERE id = ?").bind(jobId).first<{ owner_session_id: string | null }>();
  if (!job) throw new GameError("That job isn't on the board.", 404);
  if (job.owner_session_id !== sessionId) throw new GameError("Only the account that started this project can authorize it or choose its winner.", 403);
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
    .bind(jobId, sessionId, ip, now, limits.total, day, limits.daily, sessionId, day, limits.account, ip, day, limits.ip,
      now - 30000, new Date(now - 120000).toISOString()).run();
  if (result.meta.changes !== 1) throw new GameError("The demo limit is reached or another round is being made. Try later, or explore the public rounds.", 429);
}
