import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import vm from "node:vm";

const directory = await mkdtemp(join(tmpdir(), "burn-rate-tests-"));
await build({
  stdin: { contents: 'export { default } from "./src/index.ts"; export { ensureReady, runRound } from "./src/game.ts"; export { reserveGeneration, hash } from "./src/access.ts"; export { cleanup } from "./src/retention.ts";', resolveDir: process.cwd() },
  outfile: join(directory, "worker.mjs"), bundle: true, platform: "node", format: "esm", target: "es2022",
  plugins: [{ name: "workers-stub", setup(b) {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "workers", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export class WorkflowEntrypoint {}", loader: "js" }));
  } }],
});
const { default: worker, ensureReady, runRound, reserveGeneration, hash, cleanup } = await import(join(directory, "worker.mjs"));
let mf, env, pending, calls, emails;
const realFetch = globalThis.fetch;

function mediaBucket() {
  const objects = new Map();
  return {
    async put(key, value, options) { objects.set(key, { value, type: options?.httpMetadata?.contentType }); },
    async get(key) { return objects.get(key) ?? null; },
    async list({ prefix }) { return { objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }; },
    async delete(keys) { for (const key of [keys].flat()) objects.delete(key); },
    objects,
  };
}

async function openrouter(url, init) {
  const path = new URL(url).pathname;
  const input = JSON.parse(init.body);
  calls.push({ path, model: input.model, input });
  if (path.endsWith("/images")) return Response.json({ data: [{ b64_json: "AAAA", media_type: "image/png" }], usage: { cost: 0.04 } });
  const name = input.response_format.json_schema.name;
  const content = name === "plan"
    ? { choice: input.messages.at(-1).content.match(/^- (\S+) \|/m)[1], reason: "Make something useful.", prompt: "Make a useful piece", take: "A clear idea",
        pitch: "A useful piece for your brief.", bid: 1, notes: "Covers my costs." }
    : name === "artifact" ? { eyebrow: "Test", title: "A clear idea", lede: "Here is the idea.", points: [{ h: "Try", body: "A concrete next step." }] }
    : { title: "A bit", lines: ["One.", "Two.", "Three."], tag: "Done." };
  return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { cost: 0.01 } });
}

beforeEach(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: { DB: crypto.randomUUID() }, compatibilityDate: "2026-10-07" }));
  calls = [];
  pending = [];
  globalThis.fetch = async (url, init) => String(url).startsWith("https://openrouter.ai/") ? openrouter(url, init) : realFetch(url, init);
  emails = [];
  env = {
    DB: await mf.getD1Database("DB"), DEMO_ACCESS_CODE: "private-test-invite-code", GENERATION_ENABLED: "true", PAYPAL_MODE: "sandbox",
    AUTH_SECRET: "private-test-auth-secret-at-least-32-characters", EMAIL_FROM: "signin@burnrateagents.com",
    APP_ORIGIN: "https://burnrating.com",
    EMAIL: { async send(message) { emails.push(message); return { messageId: crypto.randomUUID() }; } },
    OPENROUTER_API_KEY: "test-openrouter-key",
    MEDIA: mediaBucket(),
    ASSETS: { fetch: () => new Response("static") },
  };
  await ensureReady(env.DB);
});
afterEach(async () => { await Promise.allSettled(pending); globalThis.fetch = realFetch; await mf.dispose(); });
after(async () => { await rm(directory, { recursive: true, force: true }); });

test("old domains and noncanonical URLs redirect before accessing app bindings", async () => {
  const path = "/api/jobs/round-123?return=%2Fabout&x=1";
  for (const origin of ["http://burnrating.com", "https://www.burnrating.com", "https://burnrateagents.com", "https://www.burnrateagents.com", "http://burnrateagents.com", "http://www.burnrateagents.com"]) {
    for (const method of ["GET", "HEAD", "POST"]) {
      const response = await worker.fetch(new Request(`${origin}${path}`, { method }), {}, {});
      assert.equal(response.status, 308, `${method} ${origin}`);
      assert.equal(response.headers.get("location"), `https://burnrating.com${path}`);
    }
  }
  for (const origin of ["https://burnrating.com", "http://localhost:8787"]) {
    const response = await worker.fetch(new Request(`${origin}/about`), env, {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
  }
});

async function request(path, { method = "GET", body, cookie, origin, ip = "203.0.113.1" } = {}) {
  return worker.fetch(new Request(`https://burnrating.com${path}`, {
    method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  }), env, { waitUntil(promise) { pending.push(promise); } });
}
async function emailLink(email, ip = "203.0.113.1", cookie) {
  const response = await request("/api/session/email", { method: "POST", body: { email }, ip, cookie });
  assert.equal(response.status, 200);
  const token = emails.at(-1).text.match(/#\/sign-in\/([a-f0-9]{64})/)[1];
  return { token, browser: response.headers.get("set-cookie").split(";")[0] };
}
async function login(ip = "203.0.113.1", email = `${crypto.randomUUID()}@example.com`, previousCookie) {
  const { token, browser } = await emailLink(email, ip);
  const response = await request("/api/session/verify", { method: "POST", body: { token }, cookie: [browser, previousCookie].filter(Boolean).join("; "), ip });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=604800; Secure/);
  return cookie.split(";")[0];
}
const job = { category: "artifact", brief: "A launch memo for a coffee shop", offer: 2, mode: "house" };
async function post(cookie, body = job) {
  const response = await request("/api/jobs", { method: "POST", body, cookie });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test("anonymous, forged-cookie, cross-origin and oversized requests cannot start paid work", async () => {
  for (const cookie of [undefined, "burn_rate_session=" + "a".repeat(64)]) {
    assert.equal((await request("/api/jobs", { method: "POST", body: job, cookie })).status, 401);
  }
  assert.equal((await request("/api/session/email", { method: "POST", body: { email: "test@example.com" }, origin: "https://attacker.example" })).status, 403);
  assert.equal((await request("/api/session", { method: "POST", body: { code: env.DEMO_ACCESS_CODE } })).status, 404);
  assert.equal((await request("/api/jobs", { method: "POST", body: "x".repeat(5000) })).status, 413);
  assert.equal(calls.length, 0);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM generation_requests").first()).n, 0);
});

test("email verification is required; links are browser-bound, single-use, expiring and scanner-safe", async () => {
  const { token, browser } = await emailLink("New.User@example.com");
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first()).n, 0);
  assert.equal((await request("/api/session/verify", { method: "POST", body: { token } })).status, 401);
  assert.equal((await request("/api/session/verify", { method: "POST", body: { token }, cookie: "burn_rate_login=" + "a".repeat(64) })).status, 401);
  assert.equal((await request("/api/session/verify", { method: "POST", body: { token }, cookie: browser, origin: "https://attacker.example" })).status, 403);
  assert.equal((await request(`/api/session/verify?token=${token}`, { cookie: browser })).status, 404);
  const stored = await env.DB.prepare("SELECT * FROM login_links").first();
  assert.notEqual(stored.token_hash, token);
  const verify = () => request("/api/session/verify", { method: "POST", body: { token }, cookie: browser });
  const confirmations = await Promise.all([verify(), verify()]);
  assert.equal(confirmations.filter((response) => response.status === 200).length, 1);
  assert.equal((await verify()).status, 401);
  assert.equal((await env.DB.prepare("SELECT email FROM accounts").first()).email, "new.user@example.com");
  const expired = await emailLink("expired@example.com");
  await env.DB.prepare("UPDATE login_links SET expires_at = 0").run();
  assert.equal((await request("/api/session/verify", { method: "POST", body: { token: expired.token }, cookie: expired.browser })).status, 401);
});

test("session expiry and logout revoke access without losing account ownership", async () => {
  const cookie = await login();
  assert.equal((await (await request("/api/session", { cookie })).json()).authenticated, true);
  await request("/api/session/logout", { method: "POST", body: {}, cookie });
  assert.equal((await (await request("/api/session", { cookie })).json()).authenticated, false);
  const expiring = await login();
  await env.DB.prepare("UPDATE access_sessions SET expires_at = 0").run();
  assert.equal((await (await request("/api/session", { cookie: expiring })).json()).authenticated, false);
});

test("email sends have atomic per-recipient, per-IP and shared caps, including failed sends", async () => {
  assert.equal((await request("/api/session/email", { method: "POST", body: { email: "bad\r\naddress" } })).status, 400);
  await emailLink("same@example.com");
  assert.equal((await request("/api/session/email", { method: "POST", body: { email: "SAME@example.com" }, ip: "203.0.113.99" })).status, 429);
  const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) => request("/api/session/email", { method: "POST", body: { email: `another-${i}@example.com` } })));
  assert.equal(attempts.filter((response) => response.status === 200).length, 4);
  await env.DB.prepare("DELETE FROM email_requests").run();
  env.EMAIL.send = async () => { throw new Error("private provider error"); };
  for (let i = 0; i < 5; i++) assert.equal((await request("/api/session/email", { method: "POST", body: { email: `fail-${i}@example.com` } })).status, 503);
  assert.equal((await request("/api/session/email", { method: "POST", body: { email: "limited@example.com" } })).status, 429);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM email_requests").first()).n, 5);
  await env.DB.prepare("DELETE FROM email_requests").run();
  for (let i = 0; i < 100; i++) await env.DB.prepare("INSERT INTO email_requests VALUES (?, ?, ?, ?)").bind(String(i), String(i), String(i), Date.now()).run();
  assert.equal((await request("/api/session/email", { method: "POST", body: { email: "global@example.com" }, ip: "203.0.113.77" })).status, 429);
});

test("the same email recovers its rounds and cannot reset the daily allowance with a new session", async () => {
  const owner = await login("203.0.113.1", "owner@example.com");
  const { jobId } = await post(owner);
  await Promise.all(pending);
  await request("/api/session/logout", { method: "POST", body: {}, cookie: owner });
  await env.DB.prepare("UPDATE email_requests SET created_at = 0").run();
  const returning = await login("203.0.113.2", "OWNER@example.com");
  const view = await (await request(`/api/jobs/${jobId}`, { cookie: returning })).json();
  assert.equal(view.job.isOwner, true);
  assert.doesNotMatch(JSON.stringify(await (await request("/api/arena")).json()), /owner@example.com/i);
  await env.DB.prepare("UPDATE generation_requests SET created_at = ?").bind(Date.now() - 60000).run();
  env.GENERATION_ACCOUNT_LIMIT = "1";
  assert.equal((await request("/api/jobs", { method: "POST", body: job, cookie: returning, ip: "203.0.113.2" })).status, 429);
});

test("schema v2 invite sessions can finish old rounds and claim them only with the original cookie", async () => {
  // Recreate the old session table to exercise the additive v2 -> v3 migration.
  await env.DB.prepare("DROP TABLE access_sessions").run();
  await env.DB.prepare("CREATE TABLE access_sessions (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)").run();
  await env.DB.prepare("UPDATE app_meta SET value = '2' WHERE key = 'schema_version'").run();
  await ensureReady(env.DB);
  const token = "b".repeat(64);
  const id = await hash(token);
  await env.DB.prepare("INSERT INTO access_sessions VALUES (?, ?, ?, NULL)").bind(id, await hash(env.DEMO_ACCESS_CODE), Date.now() + 86400000).run();
  const legacy = `burn_rate_session=${token}`;
  await env.DB.prepare("INSERT INTO jobs (id, category, brief, offer_usd, status, mode, created_at, owner_session_id) VALUES ('legacy', 'image', 'A public project', 2, 'draft', 'house', ?, ?)").bind(new Date().toISOString(), id).run();
  await env.DB.prepare("INSERT INTO generation_requests VALUES ('legacy', ?, 'old-ip', ?)").bind(id, Date.now()).run();
  assert.equal((await (await request("/api/session", { cookie: legacy })).json()).authenticated, false);
  assert.equal((await (await request("/api/jobs/legacy", { cookie: legacy })).json()).job.isOwner, true);
  assert.equal((await request("/api/jobs", { method: "POST", body: job, cookie: legacy })).status, 401);
  const accountCookie = await login("203.0.113.1", "owner@example.com", legacy);
  assert.equal((await (await request("/api/jobs/legacy", { cookie: accountCookie })).json()).job.isOwner, true);
  const principal = (await env.DB.prepare("SELECT id FROM accounts").first()).id;
  assert.equal((await env.DB.prepare("SELECT session_id FROM generation_requests WHERE job_id = 'legacy'").first()).session_id, principal);
  assert.equal((await (await request("/api/jobs/legacy", { cookie: legacy })).json()).job.isOwner, false);
});

test("rounds run once; only their owner can authorize or select, and settlement retries do not double-credit", async () => {
  const owner = await login();
  const stranger = await login("203.0.113.2");
  const { jobId } = await post(owner);
  await Promise.all([...pending, runRound(env, jobId), runRound(env, jobId)]);
  assert.equal(calls.length, 8, "four decisions and four makes, even with duplicate dispatch");
  const view = await (await request(`/api/jobs/${jobId}`, { cookie: owner })).json();
  assert.equal(view.job.isOwner, true);
  assert.equal(view.job.status, "judging");
  assert.equal((await (await request(`/api/jobs/${jobId}`)).json()).job.authorizationId, null);
  assert.equal((await (await request(`/api/jobs/${jobId}`, { cookie: stranger })).json()).job.isOwner, false);
  const entryId = view.entries.find((entry) => entry.status === "ready").id;
  for (const action of ["authorize", "winner"]) {
    assert.equal((await request(`/api/jobs/${jobId}/${action}`, { method: "POST", body: { entryId }, cookie: stranger })).status, 403);
    assert.equal((await request(`/api/jobs/${jobId}/${action}`, { method: "POST", body: { entryId } })).status, 401);
  }
  const settle = () => request(`/api/jobs/${jobId}/winner`, { method: "POST", body: { entryId }, cookie: owner });
  const results = await Promise.all([settle(), settle()]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal((await settle()).status, 200);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM wallet_ledger WHERE type = 'win'").first()).n, 1);
});

test("atomic global reservations survive concurrent requests, new sessions, and round deletion", async () => {
  env.GENERATION_TOTAL_LIMIT = "1";
  const req = new Request("https://burnrating.com/api/jobs");
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => reserveGeneration(env, req, `browser-${i}`, crypto.randomUUID())));
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  await env.DB.prepare("UPDATE generation_requests SET created_at = ?").bind(Date.now() - 86400000).run();
  await assert.rejects(reserveGeneration(env, req, "another-browser", crypto.randomUUID()), /limit/);
});

test("daily, account and IP limits apply to house and PayPal requests; cooldown is shared", async () => {
  const cookie = await login();
  const { jobId } = await post(cookie);
  assert.equal((await request("/api/jobs", { method: "POST", body: { ...job, mode: "paypal" }, cookie })).status, 429);
  await Promise.all(pending);
  await env.DB.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").bind(jobId).run();
  await env.DB.prepare("UPDATE generation_requests SET created_at = ?").bind(Date.now() - 60000).run();
  const req = new Request("https://burnrating.com/api/jobs", { headers: { "cf-connecting-ip": "203.0.113.1" } });
  const sessionId = (await env.DB.prepare("SELECT user_id FROM access_sessions LIMIT 1").first()).user_id;
  for (const key of ["GENERATION_ACCOUNT_LIMIT", "GENERATION_IP_LIMIT", "GENERATION_DAILY_LIMIT"]) {
    env[key] = "1";
    await assert.rejects(reserveGeneration(env, req, sessionId, crypto.randomUUID()), /limit/);
    delete env[key];
  }
});

test("paused or unconfigured generation fails closed before any AI call", async () => {
  const cookie = await login();
  env.GENERATION_ENABLED = "false";
  assert.equal((await request("/api/jobs", { method: "POST", body: job, cookie })).status, 503);
  env.GENERATION_ENABLED = "true";
  delete env.OPENROUTER_API_KEY;
  assert.equal((await request("/api/jobs", { method: "POST", body: job, cookie })).status, 503);
  delete env.EMAIL;
  assert.equal((await request("/api/jobs", { method: "POST", body: job, cookie })).status, 503);
  assert.equal((await request("/api/session/email", { method: "POST", body: { email: "test@example.com" } })).status, 503);
  assert.equal(calls.length, 0);
});

test("image rounds are bounded to four plan calls and four image calls, each on the agent's own model", async () => {
  const cookie = await login();
  const { jobId } = await post(cookie, { ...job, category: "image" });
  await Promise.all(pending);
  const plans = calls.filter((call) => call.path.endsWith("/chat/completions"));
  assert.equal(plans.length, 4);
  assert.equal(new Set(plans.map((call) => call.model)).size, 4);
  assert.equal(calls.filter((call) => call.path.endsWith("/images")).length, 4);
  assert.ok(plans.every((call) => call.input.max_tokens <= 6000));
  const view = await (await request(`/api/jobs/${jobId}`)).json();
  assert.ok(view.entries.every((entry) => /^\/api\/media\//.test(entry.deliverable.src)));
  assert.equal(env.MEDIA.objects.size, 4);
});

test("PayPal sandbox authorizes the ceiling and captures only the selected offer with final_capture", async () => {
  const originalFetch = globalThis.fetch;
  const paypalCalls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://openrouter.ai/")) return originalFetch(url, init);
    assert.equal(new URL(url).origin, "https://api-m.sandbox.paypal.com");
    const path = new URL(url).pathname;
    paypalCalls.push({ path, init });
    const data = path.endsWith("/token") ? { access_token: "test-token", expires_in: 300 }
      : path.endsWith("/authorize") ? { purchase_units: [{ payments: { authorizations: [{ id: "test-authorization", status: "CREATED" }] } }] }
      : path.endsWith("/capture") ? { id: "test-capture", status: "COMPLETED" } : { id: "test-order" };
    return Response.json(data);
  };
  env.PAYPAL_CLIENT_ID = "sandbox-test-client";
  env.PAYPAL_CLIENT_SECRET = "sandbox-test-secret";
  try {
    const cookie = await login();
    const { jobId, orderId } = await post(cookie, { ...job, mode: "paypal" });
    assert.equal(calls.length, 0, "no inference before buyer approval");
    const approve = () => request(`/api/jobs/${jobId}/authorize`, { method: "POST", body: { orderId }, cookie });
    assert.equal((await approve()).status, 200);
    await Promise.all(pending);
    assert.equal((await approve()).status, 200);
    const view = await (await request(`/api/jobs/${jobId}`, { cookie })).json();
    const entryId = view.entries.find((entry) => entry.status === "ready").id;
    const settle = () => request(`/api/jobs/${jobId}/winner`, { method: "POST", body: { entryId }, cookie });
    assert.equal((await settle()).status, 200);
    assert.equal((await settle()).status, 200);
    const order = JSON.parse(paypalCalls.find((call) => call.path === "/v2/checkout/orders").init.body);
    assert.equal(order.intent, "AUTHORIZE");
    assert.equal(order.purchase_units[0].amount.value, "2.00");
    const captures = paypalCalls.filter((call) => call.path.endsWith("/capture"));
    assert.equal(captures.length, 1);
    const capture = JSON.parse(captures[0].init.body);
    assert.equal(capture.amount.value, "1.00");
    assert.equal(capture.final_capture, true);
    assert.equal(calls.length, 8);
  } finally { globalThis.fetch = originalFetch; }
});

test("retention deletes old briefs and work but preserves counters and unsettled PayPal records", async () => {
  const old = new Date(Date.now() - 31 * 86400000).toISOString();
  for (const [id, mode, status] of [["old-house", "house", "captured"], ["open-paypal", "paypal", "judging"]]) {
    await env.DB.prepare("INSERT INTO jobs (id, category, brief, offer_usd, status, mode, created_at) VALUES (?, 'image', 'Old public brief', 2, ?, ?, ?)").bind(id, status, mode, old).run();
  }
  await env.DB.prepare("INSERT INTO entries (id, job_id, agent_id, status, created_at) VALUES ('old-entry', 'old-house', 'test', 'ready', ?)").bind(old).run();
  await env.DB.prepare("INSERT INTO generation_requests VALUES ('old-house', 'browser', 'ip-hash', ?)").bind(Date.now() - 31 * 86400000).run();
  await cleanup(env.DB);
  assert.equal(await env.DB.prepare("SELECT id FROM jobs WHERE id = 'old-house'").first(), null);
  assert.equal(await env.DB.prepare("SELECT id FROM entries WHERE id = 'old-entry'").first(), null);
  assert.ok(await env.DB.prepare("SELECT id FROM jobs WHERE id = 'open-paypal'").first());
  assert.equal((await env.DB.prepare("SELECT session_id FROM generation_requests").first()).session_id, "");
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM generation_requests").first()).n, 1);
});

test("generated SVG and injected markup render as inert images or escaped text", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const context = vm.createContext({ encodeURIComponent });
  const escapeSource = source.slice(source.indexOf("const esc ="), source.indexOf("const pct ="));
  const renderSource = source.slice(source.indexOf("function svgImage("), source.indexOf("function wirePlayers("));
  vm.runInContext(`${escapeSource}\n${renderSource}`, context);
  const html = vm.runInContext(`workHTML({kind:'image', svg:'<svg onload="alert(1)"><script>alert(1)</script></svg>', src:'javascript:alert(1)', caption:'<img onerror="alert(1)">'})`, context);
  assert.match(html, /data:image\/svg\+xml,%3Csvg/);
  assert.doesNotMatch(html, /<svg|<script|src="javascript:/);
  assert.match(html, /&lt;img/);
});

test("project drafts survive reload and sign-in navigation, expire, and clear after submission", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const functions = source.slice(source.indexOf("const DRAFT_KEY"), source.indexOf("function emailFormHTML"));
  const storage = new Map();
  let now = Date.now();
  const newPage = () => {
    const context = vm.createContext({ Date: { now: () => now }, localStorage: {
      getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key),
    } });
    vm.runInContext(functions, context);
    return context;
  };
  let page = newPage();
  const draft = { category: "video", brief: "A storyboard for an open-air cinema", offer: 4 };
  vm.runInContext(`saveProjectDraft(${JSON.stringify(draft)})`, page);
  page = newPage();
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(projectDraft())", page)), { ...draft, updatedAt: now });
  now += 86400001;
  assert.equal(vm.runInContext("projectDraft()", page), null);
  assert.equal(storage.size, 0);
  vm.runInContext(`saveProjectDraft(${JSON.stringify(draft)}); clearProjectDraft()`, page);
  assert.equal(vm.runInContext("projectDraft()", newPage()), null);
});
