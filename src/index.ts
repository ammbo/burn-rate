import { Hono } from "hono";
import { GameError } from "./errors";
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

app.use("/api/*", async (c, next) => {
  await ensureReady(c.env.DB);
  await next();
});

app.onError((error, c) => {
  if (error instanceof GameError) return c.json({ error: error.message }, error.status as 400);
  console.log(JSON.stringify({ event: "error", message: error.message }));
  return c.json({ error: "The room hit a snag." }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/config", (c) => c.json(configView(c.env)));

app.get("/api/arena", async (c) => c.json(await arenaView(c.env)));

app.get("/api/graveyard", async (c) => c.json(await graveyardView(c.env)));

app.get("/api/ledger", async (c) => c.json(await ledgerView(c.env)));

app.get("/api/agents/:id", async (c) => c.json(await agentView(c.env, c.req.param("id"))));

app.get("/api/jobs/:id", async (c) => c.json(await jobView(c.env, c.req.param("id"))));

app.post("/api/jobs", async (c) => {
  const posted = readJob(await c.req.json().catch(() => null));
  const created = await createJob(c.env, posted);
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
  const body = (await c.req.json().catch(() => null)) as { orderId?: string } | null;
  const jobId = c.req.param("id");
  const approved = await approveJob(c.env, jobId, body?.orderId ?? "");
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
  const body = (await c.req.json().catch(() => null)) as { entryId?: string } | null;
  const resolution = await pickWinner(c.env, c.req.param("id"), body?.entryId ?? "");
  return c.json(resolution);
});

app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));

export default app;
