import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { GameError } from "./errors";
import { assertSameOrigin, requireSession, reserveGeneration, sessionFor, signIn, signOut } from "./access";
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

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const productionHost = url.hostname === "burnrateagents.com" || url.hostname === "www.burnrateagents.com";
  if (productionHost && (url.hostname.startsWith("www.") || url.protocol !== "https:")) {
    url.hostname = "burnrateagents.com";
    url.protocol = "https:";
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

app.get("/api/session", async (c) => c.json({ authenticated: Boolean(await sessionFor(c.env, c.req.raw)) }));
app.post("/api/session", async (c) => {
  const body = await c.req.json<{ code?: unknown }>().catch(() => null);
  c.header("Set-Cookie", await signIn(c.env, c.req.raw, body?.code));
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
  const sessionId = await requireSession(c.env, c.req.raw);
  const posted = readJob(await c.req.json().catch(() => null));
  const jobId = crypto.randomUUID();
  await reserveGeneration(c.env, c.req.raw, sessionId, jobId);
  const created = await createJob(c.env, posted, sessionId, jobId);
  if (posted.mode === "house") {
    const jobId = created.jobId;
    c.executionCtx.waitUntil(
      runRound(c.env, jobId).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "error";
        console.log(JSON.stringify({ event: "round_crash", jobId, message }));
      }),
    );
  }
  return c.json(created);
});

app.post("/api/jobs/:id/authorize", async (c) => {
  const sessionId = await requireSession(c.env, c.req.raw);
  const body = (await c.req.json().catch(() => null)) as { orderId?: string } | null;
  const jobId = c.req.param("id");
  const approved = await approveJob(c.env, jobId, body?.orderId ?? "", sessionId);
  if (approved.status === "casting") {
    c.executionCtx.waitUntil(
      runRound(c.env, jobId).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "error";
        console.log(JSON.stringify({ event: "round_crash", jobId, message }));
      }),
    );
  }
  return c.json({ jobId, ...approved });
});

app.post("/api/jobs/:id/winner", async (c) => {
  const sessionId = await requireSession(c.env, c.req.raw);
  const body = (await c.req.json().catch(() => null)) as { entryId?: string } | null;
  const resolution = await pickWinner(c.env, c.req.param("id"), body?.entryId ?? "", sessionId);
  return c.json(resolution);
});

app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));

app.on(["GET", "HEAD"], "*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: AppEnv): Promise<void> {
    await ensureReady(env.DB);
    await cleanup(env.DB);
  },
};
