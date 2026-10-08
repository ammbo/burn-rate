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
  stdin: { contents: 'export { default } from "./src/index.ts"; export { ensureReady, runRound } from "./src/game.ts"; export { reserveGeneration } from "./src/access.ts"; export { cleanup } from "./src/retention.ts";', resolveDir: process.cwd() },
  outfile: join(directory, "worker.mjs"), bundle: true, platform: "node", format: "esm", target: "es2022",
});
const { default: worker, ensureReady, runRound, reserveGeneration, cleanup } = await import(join(directory, "worker.mjs"));
let mf, env, pending, calls;

beforeEach(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: { DB: crypto.randomUUID() }, compatibilityDate: "2026-10-07" }));
  calls = [];
  pending = [];
  env = {
    DB: await mf.getD1Database("DB"), DEMO_ACCESS_CODE: "private-test-invite-code", GENERATION_ENABLED: "true", PAYPAL_MODE: "sandbox",
    AI: { async run(model, input) {
      calls.push({ model, input });
      if (model.includes("flux")) return { image: "AAAA" };
      const user = input.messages.at(-1).content;
      if (user.startsWith("New job")) return { response: { choice: user.match(/^- (\w+):/m)[1], reason: "Make something useful." } };
      return { response: { prompt: "Make a useful poster", take: "A clear idea", pitch: "A useful piece for your brief.", bid: 1,
        reasoning: "Covers my costs.", work: { caption: "A useful poster", eyebrow: "Test", title: "A clear idea", lede: "Here is the idea.", points: [{ h: "Try", body: "A concrete next step." }] } } };
    } },
    ASSETS: { fetch: () => new Response("static") },
  };
  await ensureReady(env.DB);
});
afterEach(async () => { await Promise.allSettled(pending); await mf.dispose(); });
after(async () => { await rm(directory, { recursive: true, force: true }); });

async function request(path, { method = "GET", body, cookie, origin, ip = "203.0.113.1" } = {}) {
  return worker.fetch(new Request(`https://burnrateagents.com${path}`, {
    method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  }), env, { waitUntil(promise) { pending.push(promise); } });
}
async function login(ip = "203.0.113.1") {
  const response = await request("/api/session", { method: "POST", body: { code: env.DEMO_ACCESS_CODE }, ip });
  assert.equal(response.status, 200);
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
  assert.equal((await request("/api/session", { method: "POST", body: { code: env.DEMO_ACCESS_CODE }, origin: "https://attacker.example" })).status, 403);
  assert.equal((await request("/api/jobs", { method: "POST", body: "x".repeat(5000) })).status, 413);
  assert.equal(calls.length, 0);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM generation_requests").first()).n, 0);
});

test("invite attempts are throttled and rotation, expiry and logout revoke sessions", async () => {
  const cookie = await login();
  assert.equal((await (await request("/api/session", { cookie })).json()).authenticated, true);
  env.DEMO_ACCESS_CODE = "rotated-private-code";
  assert.equal((await (await request("/api/session", { cookie })).json()).authenticated, false);
  const fresh = await login();
  await request("/api/session/logout", { method: "POST", body: {}, cookie: fresh });
  assert.equal((await (await request("/api/session", { cookie: fresh })).json()).authenticated, false);
  const expiring = await login();
  await env.DB.prepare("UPDATE access_sessions SET expires_at = 0").run();
  assert.equal((await (await request("/api/session", { cookie: expiring })).json()).authenticated, false);
  for (let i = 0; i < 5; i++) assert.equal((await request("/api/session", { method: "POST", body: { code: "wrong" }, ip: "203.0.113.99" })).status, 401);
  assert.equal((await request("/api/session", { method: "POST", body: { code: env.DEMO_ACCESS_CODE }, ip: "203.0.113.99" })).status, 429);
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
  const req = new Request("https://burnrateagents.com/api/jobs");
  const attempts = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => reserveGeneration(env, req, `browser-${i}`, crypto.randomUUID())));
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  await env.DB.prepare("UPDATE generation_requests SET created_at = ?").bind(Date.now() - 86400000).run();
  await assert.rejects(reserveGeneration(env, req, "another-browser", crypto.randomUUID()), /limit/);
});

test("daily, browser and IP limits apply to house and PayPal requests; cooldown is shared", async () => {
  const cookie = await login();
  const { jobId } = await post(cookie);
  assert.equal((await request("/api/jobs", { method: "POST", body: { ...job, mode: "paypal" }, cookie })).status, 429);
  await Promise.all(pending);
  await env.DB.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").bind(jobId).run();
  await env.DB.prepare("UPDATE generation_requests SET created_at = ?").bind(Date.now() - 60000).run();
  const req = new Request("https://burnrateagents.com/api/jobs", { headers: { "cf-connecting-ip": "203.0.113.1" } });
  const sessionId = (await env.DB.prepare("SELECT id FROM access_sessions LIMIT 1").first()).id;
  for (const key of ["GENERATION_SESSION_LIMIT", "GENERATION_IP_LIMIT", "GENERATION_DAILY_LIMIT"]) {
    env[key] = "1";
    await assert.rejects(reserveGeneration(env, req, sessionId, crypto.randomUUID()), /limit/);
    delete env[key];
  }
});

test("paused or unconfigured generation fails closed before any AI call", async () => {
  const cookie = await login();
  env.GENERATION_ENABLED = "false";
  assert.equal((await request("/api/jobs", { method: "POST", body: job, cookie })).status, 503);
  delete env.DEMO_ACCESS_CODE;
  assert.equal((await request("/api/jobs", { method: "POST", body: job, cookie })).status, 401);
  assert.equal(calls.length, 0);
});

test("image rounds are bounded to eight text and four image calls", async () => {
  const cookie = await login();
  await post(cookie, { ...job, category: "image" });
  await Promise.all(pending);
  assert.equal(calls.filter((call) => call.model.includes("llama")).length, 8);
  assert.equal(calls.filter((call) => call.model.includes("flux")).length, 4);
  assert.ok(calls.every((call) => call.input.max_tokens <= 900 || call.input.steps <= 8));
});

test("PayPal sandbox authorizes the ceiling and captures only the selected offer with final_capture", async () => {
  const originalFetch = globalThis.fetch;
  const paypalCalls = [];
  globalThis.fetch = async (url, init) => {
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
