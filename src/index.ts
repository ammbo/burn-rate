import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { GameError } from "./errors";
import { accountView, assertSameOrigin, confirmSignIn, requestSignIn, requireAccount, requireSession, reserveGeneration, sessionFor, signOut } from "./access";
import { cleanup } from "./retention";
import {
  agentView,
  approveJob,
  arenaView,
  configView,
  createJob,
  ensureReady,
  graveyardView,
  jobView,
  ledgerView,
  pickWinner,
  readJob,
  runRound,
  type AppEnv,
} from "./game";

const app = new Hono<{ Bindings: AppEnv }>();

function dispatch(env: AppEnv, ctx: { waitUntil(promise: Promise<unknown>): void }, jobId: string): void {
  const crash = (error: unknown) => {
    const message = error instanceof Error ? error.message : "error";
    console.log(JSON.stringify({ event: "round_crash", jobId, message }));
  };
  // Tests and plain `wrangler dev` without the binding run the round inline.
  if (env.ROUNDS) ctx.waitUntil(env.ROUNDS.create({ id: jobId, params: { jobId } }).then(() => undefined, crash));
  else ctx.waitUntil(runRound(env, jobId).catch(crash));
}

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const productionHost = ["burnrating.com", "www.burnrating.com", "burnrateagents.com", "www.burnrateagents.com"].includes(url.hostname);
  if (productionHost && (url.hostname !== "burnrating.com" || url.protocol !== "https:")) {
    url.hostname = "burnrating.com";
    url.protocol = "https:";
    url.port = "";
    return c.redirect(url.toString(), 308);
  }
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  if (c.res.status >= 400) c.header("X-Robots-Tag", "noindex");
});

app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  await ensureReady(c.env.DB);
  await next();
});

app.use("/api/*", bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: "Keep requests under 4 KB." }, 413) }));
app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD"].includes(c.req.method)) assertSameOrigin(c.req.raw);
  await next();
});

app.onError((error, c) => {
  if (error instanceof GameError) return c.json({ error: error.message }, error.status as 400);
  console.log(JSON.stringify({ event: "error", message: error.message }));
  return c.json({ error: "The room hit a snag." }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/config", (c) => c.json(configView(c.env)));

app.get("/api/session", async (c) => {
  const { view, cookie } = await accountView(c.env, c.req.raw);
  if (cookie) c.header("Set-Cookie", cookie);
  return c.json(view);
});
app.post("/api/session/email", async (c) => {
  const body = await c.req.json<{ email?: unknown }>().catch(() => null);
  c.header("Set-Cookie", await requestSignIn(c.env, c.req.raw, body?.email));
  return c.json({ sent: true });
});
app.post("/api/session/verify", async (c) => {
  const body = await c.req.json<{ token?: unknown }>().catch(() => null);
  for (const cookie of await confirmSignIn(c.env, c.req.raw, body?.token)) c.header("Set-Cookie", cookie, { append: true });
  return c.json({ authenticated: true });
});
app.post("/api/session/logout", async (c) => {
  c.header("Set-Cookie", await signOut(c.env, c.req.raw));
  return c.json({ authenticated: false });
});

app.get("/api/arena", async (c) => c.json(await arenaView(c.env)));

app.get("/api/graveyard", async (c) => c.json(await graveyardView(c.env)));

app.get("/api/ledger", async (c) => c.json(await ledgerView(c.env)));

app.get("/api/agents/:id", async (c) => c.json(await agentView(c.env, c.req.param("id"))));

app.get("/api/jobs/:id", async (c) => c.json(await jobView(c.env, c.req.param("id"), await sessionFor(c.env, c.req.raw))));

app.post("/api/jobs", async (c) => {
  const sessionId = await requireAccount(c.env, c.req.raw);
  const posted = readJob(await c.req.json().catch(() => null));
  const jobId = crypto.randomUUID();
  await reserveGeneration(c.env, c.req.raw, sessionId, jobId);
  const created = await createJob(c.env, posted, sessionId, jobId);
  if (posted.mode === "house") dispatch(c.env, c.executionCtx, created.jobId);
  return c.json(created);
});

app.post("/api/jobs/:id/authorize", async (c) => {
  const sessionId = await requireSession(c.env, c.req.raw);
  const body = (await c.req.json().catch(() => null)) as { orderId?: string } | null;
  const jobId = c.req.param("id");
  const approved = await approveJob(c.env, jobId, body?.orderId ?? "", sessionId);
  if (approved.status === "casting") dispatch(c.env, c.executionCtx, jobId);
  return c.json({ jobId, ...approved });
});

app.post("/api/jobs/:id/winner", async (c) => {
  const sessionId = await requireSession(c.env, c.req.raw);
  const body = (await c.req.json().catch(() => null)) as { entryId?: string } | null;
  const resolution = await pickWinner(c.env, c.req.param("id"), body?.entryId ?? "", sessionId);
  return c.json(resolution);
});

app.get("/api/media/:job/:file", async (c) => {
  const key = `jobs/${c.req.param("job")}/${c.req.param("file")}`;
  if (!/^jobs\/[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}\.(png|jpeg|webp|svg|mp4)$/.test(key)) return c.json({ error: "Not found." }, 404);
  const range = c.req.header("range");
  const object = await c.env.MEDIA.get(key, range ? { range: c.req.raw.headers } : {});
  if (!object || !("body" in object)) return c.json({ error: "Not found." }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=604800, immutable");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
  headers.set("X-Content-Type-Options", "nosniff");
  const span = object.range as { offset?: number; length?: number } | undefined;
  if (range && span && typeof span.offset === "number") {
    const length = span.length ?? object.size - span.offset;
    headers.set("Content-Range", `bytes ${span.offset}-${span.offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
});

app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));

app.on(["GET", "HEAD"], "*", (c) => c.env.ASSETS.fetch(c.req.raw));

export { RoundWorkflow } from "./workflow";

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: AppEnv): Promise<void> {
    await ensureReady(env.DB);
    await cleanup(env.DB, Date.now(), env.MEDIA);
  },
};
