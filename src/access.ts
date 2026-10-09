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
  OPENROUTER_API_KEY?: string;
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
const SESSION_SECONDS = 30 * 86400;
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
  return emailConfigured(env) && env.GENERATION_ENABLED === "true" && Boolean(env.OPENROUTER_API_KEY);
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
  const row = await env.DB.prepare(`SELECT s.code_hash, s.user_id, s.expires_at, a.email FROM access_sessions s
    LEFT JOIN accounts a ON a.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`)
    .bind(id, Date.now()).first<{ code_hash: string; user_id: string | null; expires_at: number; email: string | null }>();
  if (!row) return null;
  if (row.user_id && row.email) return { id, token, expiresAt: row.expires_at, principal: row.user_id, email: row.email };
  // Previously issued invite sessions can still finish their existing rounds.
  if (env.DEMO_ACCESS_CODE && equalHash(row.code_hash, await hash(env.DEMO_ACCESS_CODE))) return { id, token, expiresAt: row.expires_at, principal: id, email: null };
  return null;
}

export async function sessionFor(env: AccessEnv, request: Request): Promise<string | null> {
  return (await readSession(env, request))?.principal ?? null;
}

export async function accountView(env: AccessEnv, request: Request): Promise<{ view: { authenticated: boolean; email: string | null }; cookie?: string }> {
  const session = await readSession(env, request);
  const view = { authenticated: Boolean(session?.email), email: session?.email ?? null };
  // Sliding expiry: active account sessions are renewed once half their lifetime has passed.
  if (!session?.email || session.expiresAt - Date.now() > (SESSION_SECONDS * 1000) / 2) return { view };
  await env.DB.prepare("UPDATE access_sessions SET expires_at = ? WHERE id = ?").bind(Date.now() + SESSION_SECONDS * 1000, session.id).run();
  return { view, cookie: cookie(request, COOKIE, session.token, SESSION_SECONDS) };
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
    (SELECT COUNT(*) FROM email_requests WHERE ip_hash = ? AND created_at > ?) < 10 AND
    (SELECT COUNT(*) FROM email_requests WHERE email_hash = ? AND created_at > ?) < 5 AND
    NOT EXISTS (SELECT 1 FROM email_requests WHERE email_hash = ? AND created_at > ?)`)
    .bind(crypto.randomUUID(), emailHash, ip, now, now - 86400000, ip, now - 900000, emailHash, now - 900000, emailHash, now - 15000).run();
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

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export async function notifyRoundClosed(env: AccessEnv, jobId: string, sold: boolean): Promise<void> {
  if (!emailConfigured(env)) return;
  const row = await env.DB.prepare(`SELECT j.brief, j.offer_usd, a.email FROM jobs j JOIN accounts a ON a.id = j.owner_session_id WHERE j.id = ?`)
    .bind(jobId).first<{ brief: string; offer_usd: number; email: string }>();
  if (!row) return;
  const link = `${new URL(env.APP_ORIGIN!).origin}/#/round/${encodeURIComponent(jobId)}`;
  const brief = row.brief.length > 120 ? `${row.brief.slice(0, 117)}…` : row.brief;
  const offer = `$${row.offer_usd.toFixed(2)}`;
  try {
    await env.EMAIL!.send(sold ? {
      from: { email: env.EMAIL_FROM!, name: "Burn Rate" }, to: row.email,
      subject: "Your offers are ready",
      text: `The agents finished your project: "${brief}"\n\nCompare the offers and pay the one you want: ${link}`,
      html: `<h1>Your offers are ready.</h1><p>The agents finished your project: “${escapeHtml(brief)}”</p><p><a href="${link}">Compare the offers</a></p>`,
    } : {
      from: { email: env.EMAIL_FROM!, name: "Burn Rate" }, to: row.email,
      subject: "No agent took your project",
      text: `No agent would take your project for ${offer}: "${brief}"\n\nNothing was charged, and any hold was released. See why each agent passed: ${link}`,
      html: `<h1>No agent took your project.</h1><p>No agent would take “${escapeHtml(brief)}” for ${offer}. Nothing was charged, and any hold was released.</p><p><a href="${link}">See why each agent passed</a></p>`,
    });
  } catch {
    // Provider errors can contain recipient addresses. Do not log them.
  }
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

const DAY_MS = 86400000;
// Any reservation starts a shared cooldown; a round that is still being made holds the room longer.
const COOLDOWN_MS = 30_000;
const ROUND_LOCK_MS = 120_000;

const utcDay = (now: number) => now - (now % DAY_MS);

function untilReset(now: number): string {
  const minutes = Math.max(1, Math.ceil((utcDay(now) + DAY_MS - now) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

interface Usage { total: number; today: number; account: number; ip: number; lastAt: number | null; castingAt: number | null }

async function usageOf(env: AccessEnv, ip: string, principal: string, now: number): Promise<Usage> {
  const row = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM generation_requests) AS total,
      (SELECT COUNT(*) FROM generation_requests WHERE created_at >= ?1) AS today,
      (SELECT COUNT(*) FROM generation_requests WHERE session_id = ?2 AND created_at >= ?1) AS account,
      (SELECT COUNT(*) FROM generation_requests WHERE ip_hash = ?3 AND created_at >= ?1) AS ip,
      (SELECT MAX(created_at) FROM generation_requests) AS lastAt,
      (SELECT MAX(g.created_at) FROM generation_requests g JOIN jobs j ON j.id = g.job_id WHERE j.status = 'casting') AS castingAt`)
    .bind(utcDay(now), principal, ip).first<Usage>();
  return row ?? { total: 0, today: 0, account: 0, ip: 0, lastAt: null, castingAt: null };
}

interface Block { message: string; transient: boolean }

// Explains which limit stops a new round. Daily and total limits hold until reset;
// the cooldown and the running-round lock clear within two minutes.
function blockFor(env: AccessEnv, usage: Usage, now: number): Block | null {
  const limits = generationLimits(env);
  if (usage.total >= limits.total) {
    return { message: `The demo has used all ${limits.total} of its rounds, so new projects are closed. You can still explore the public rounds.`, transient: false };
  }
  const reset = `More open at midnight UTC, in ${untilReset(now)}.`;
  if (usage.account >= limits.account) return { message: `You’ve used all ${limits.account} of your rounds for today. ${reset}`, transient: false };
  if (usage.ip >= limits.ip) return { message: `This network has used all ${limits.ip} of its rounds for today. ${reset}`, transient: false };
  if (usage.today >= limits.daily) return { message: `The app has run all ${limits.daily} of today’s rounds. ${reset}`, transient: false };
  const cooldown = usage.lastAt ? usage.lastAt + COOLDOWN_MS : 0;
  const running = usage.castingAt ? usage.castingAt + ROUND_LOCK_MS : 0;
  const until = Math.max(cooldown, running);
  if (until <= now) return null;
  const seconds = Math.ceil((until - now) / 1000);
  const why = running > cooldown ? "Another round is being made right now." : "Another round just started.";
  return { message: `${why} Try again in ${seconds} seconds. Your project is saved.`, transient: true };
}

// Read-only check before sending someone through PayPal. The reservation itself
// happens when the round actually starts, so an abandoned checkout costs nothing.
export async function assertGenerationAvailable(env: AccessEnv, request: Request, principal: string): Promise<void> {
  assertGenerationEnabled(env);
  const now = Date.now();
  const block = blockFor(env, await usageOf(env, await ipHash(env, request), principal, now), now);
  if (block) throw new GameError(block.message, 429);
}

export async function allowanceView(env: AccessEnv, request: Request, principal: string) {
  const limits = generationLimits(env);
  const now = Date.now();
  const usage = await usageOf(env, await ipHash(env, request), principal, now);
  const block = generationEnabled(env)
    ? blockFor(env, usage, now)
    : { message: "New generations are paused. You can still explore completed rounds.", transient: false };
  return {
    limit: limits.account,
    used: usage.account,
    remaining: Math.max(0, Math.min(limits.account - usage.account, limits.ip - usage.ip, limits.daily - usage.today, limits.total - usage.total)),
    resetsAt: utcDay(now) + DAY_MS,
    blocked: block && !block.transient ? block.message : null,
  };
}

export async function reserveGeneration(env: AccessEnv, request: Request, sessionId: string, jobId: string): Promise<void> {
  assertGenerationEnabled(env);
  // Idempotent per job: a retried PayPal authorization keeps its original reservation.
  if (await env.DB.prepare("SELECT 1 FROM generation_requests WHERE job_id = ?").bind(jobId).first()) return;
  const limits = generationLimits(env);
  const now = Date.now();
  const ip = await ipHash(env, request);
  // One conditional INSERT is atomic across all Worker instances. Failed rounds
  // retain their reservation so retries cannot turn into unbounded spend.
  let result: D1Result;
  try {
    result = await env.DB.prepare(`INSERT INTO generation_requests (job_id, session_id, ip_hash, created_at)
      SELECT ?, ?, ?, ? WHERE
      (SELECT COUNT(*) FROM generation_requests) < ? AND
      (SELECT COUNT(*) FROM generation_requests WHERE created_at >= ?) < ? AND
      (SELECT COUNT(*) FROM generation_requests WHERE session_id = ? AND created_at >= ?) < ? AND
      (SELECT COUNT(*) FROM generation_requests WHERE ip_hash = ? AND created_at >= ?) < ? AND
      NOT EXISTS (SELECT 1 FROM generation_requests WHERE created_at > ?) AND
      NOT EXISTS (SELECT 1 FROM generation_requests g JOIN jobs j ON j.id = g.job_id WHERE j.status = 'casting' AND g.created_at > ?)`)
      .bind(jobId, sessionId, ip, now, limits.total, utcDay(now), limits.daily, sessionId, utcDay(now), limits.account, ip, utcDay(now), limits.ip,
        now - COOLDOWN_MS, now - ROUND_LOCK_MS).run();
  } catch (error) {
    // A concurrent request reserved this same job first.
    if (error instanceof Error && /UNIQUE constraint/i.test(error.message)) return;
    throw error;
  }
  if (result.meta.changes === 1) return;
  const block = blockFor(env, await usageOf(env, ip, sessionId, now), now);
  throw new GameError(block?.message ?? "Another round just started. Try again in a few seconds. Your project is saved.", 429);
}

// Only for a PayPal draft whose authorization failed: no inference has run.
export async function releaseGeneration(env: AccessEnv, jobId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM generation_requests WHERE job_id = ? AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND status = 'draft')")
    .bind(jobId, jobId).run();
}
