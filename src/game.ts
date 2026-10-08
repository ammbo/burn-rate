import {
  CATEGORIES,
  CHALLENGERS,
  DEATH_LINE,
  DECISION_COST,
  MENU,
  OPENING,
  STAKE,
  asVoice,
  categoryLabel,
  cents,
  isCategory,
  pickModel,
  priceBid,
  wantsToSkip,
  type CategoryId,
  type Seat,
  type Voice,
} from "./catalog";
import { GameError } from "./errors";
import { interpret, produce, thing, writePitch, writeReasoning, type Deliverable } from "./make";
import { authorizeOrder, captureAuthorization, createAuthorizationOrder, paypalReady, type PaypalEnv } from "./paypal";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_model TEXT NOT NULL,
    voice TEXT NOT NULL,
    tagline TEXT NOT NULL,
    status TEXT NOT NULL,
    born_at TEXT NOT NULL,
    died_at TEXT,
    heir_id TEXT,
    heir_name TEXT,
    journal_md TEXT NOT NULL,
    obituary_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS wallet_ledger (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    type TEXT NOT NULL,
    amount_usd REAL NOT NULL,
    ref TEXT,
    note TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    brief TEXT NOT NULL,
    offer_usd REAL NOT NULL,
    paypal_order_id TEXT,
    authorization_id TEXT,
    capture_id TEXT,
    status TEXT NOT NULL,
    mode TEXT NOT NULL,
    winner_entry_id TEXT,
    captured_amount REAL,
    resolution_json TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    status TEXT NOT NULL,
    skip_reason TEXT,
    gen_model TEXT,
    gen_label TEXT,
    cost_decision REAL NOT NULL DEFAULT 0,
    cost_generation REAL NOT NULL DEFAULT 0,
    bid REAL,
    pitch TEXT,
    deliverable_json TEXT,
    reasoning TEXT,
    gen_prompt TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS journal_versions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    job_id TEXT,
    journal_md TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ledger_agent ON wallet_ledger(agent_id)`,
  `CREATE INDEX IF NOT EXISTS entries_job ON entries(job_id)`,
];

interface AgentRow {
  id: string;
  name: string;
  base_model: string;
  voice: string;
  tagline: string;
  status: string;
  born_at: string;
  died_at: string | null;
  heir_id: string | null;
  heir_name: string | null;
  journal_md: string;
  obituary_json: string | null;
}

interface JobRow {
  id: string;
  category: string;
  brief: string;
  offer_usd: number;
  paypal_order_id: string | null;
  authorization_id: string | null;
  capture_id: string | null;
  status: string;
  mode: string;
  winner_entry_id: string | null;
  captured_amount: number | null;
  resolution_json: string | null;
  created_at: string;
}

interface EntryRow {
  id: string;
  job_id: string;
  agent_id: string;
  status: string;
  skip_reason: string | null;
  gen_model: string | null;
  gen_label: string | null;
  cost_decision: number;
  cost_generation: number;
  bid: number | null;
  pitch: string | null;
  deliverable_json: string | null;
  reasoning: string | null;
  gen_prompt: string | null;
  created_at: string;
}

export interface AppEnv extends PaypalEnv {
  DB: D1Database;
}

let ready: Promise<void> | null = null;

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ensureReady(db: D1Database): Promise<void> {
  if (!ready) {
    ready = migrateAndSeed(db).catch((error: unknown) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

async function ensureColumn(db: D1Database, table: string, column: string, definition: string): Promise<void> {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if (info.results.some((col) => col.name === column)) return;
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/duplicate column/i.test(message)) throw error;
  }
}

async function migrateAndSeed(db: D1Database): Promise<void> {
  for (const statement of SCHEMA) await db.prepare(statement).run();
  await ensureColumn(db, "entries", "gen_prompt", "TEXT");
  const row = await db.prepare("SELECT COUNT(*) AS n FROM agents").first<{ n: number }>();
  if (row && row.n > 0) return;
  try {
    await seed(db);
    log("seeded", { agents: OPENING.length, stake: STAKE });
  } catch (error) {
    const again = await db.prepare("SELECT COUNT(*) AS n FROM agents").first<{ n: number }>();
    if (!again || again.n === 0) throw error;
  }
}

async function seed(db: D1Database): Promise<void> {
  const born = Date.now();
  const statements = OPENING.flatMap((seat, index) => {
    const id = seat.id ?? crypto.randomUUID();
    const at = new Date(born + index * 1000).toISOString();
    return [
      db
        .prepare(
          `INSERT INTO agents (id, name, base_model, voice, tagline, status, born_at, journal_md)
           VALUES (?, ?, ?, ?, ?, 'alive', ?, ?)`,
        )
        .bind(id, seat.name, seat.model, seat.voice, seat.tagline, at, seat.journal),
      db
        .prepare(
          `INSERT INTO wallet_ledger (id, agent_id, ts, type, amount_usd, ref, note)
           VALUES (?, ?, ?, 'stake', ?, 'house', 'Opening stake')`,
        )
        .bind(crypto.randomUUID(), id, at, STAKE),
      db
        .prepare(`INSERT INTO journal_versions (id, agent_id, job_id, journal_md, created_at) VALUES (?, ?, NULL, ?, ?)`)
        .bind(crypto.randomUUID(), id, seat.journal, at),
    ];
  });
  await db.batch(statements);
}

async function postLedger(db: D1Database, agentId: string, type: string, amount: number, ref: string, note: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO wallet_ledger (id, agent_id, ts, type, amount_usd, ref, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), agentId, new Date().toISOString(), type, cents(amount), ref, note)
    .run();
}

async function balanceOf(db: D1Database, agentId: string): Promise<number> {
  const row = await db.prepare("SELECT COALESCE(SUM(amount_usd), 0) AS n FROM wallet_ledger WHERE agent_id = ?").bind(agentId).first<{ n: number }>();
  return cents(row?.n ?? 0);
}

async function aliveAgents(db: D1Database): Promise<AgentRow[]> {
  const rows = await db.prepare("SELECT * FROM agents WHERE status = 'alive' ORDER BY born_at ASC").all<AgentRow>();
  return rows.results;
}

async function agentById(db: D1Database, id: string): Promise<AgentRow | null> {
  return db.prepare("SELECT * FROM agents WHERE id = ?").bind(id).first<AgentRow>();
}

function usedNames(rows: { name: string }[]): Set<string> {
  return new Set(rows.map((row) => row.name));
}

function nextSeat(used: Set<string>): Seat {
  const fresh = CHALLENGERS.find((seat) => !used.has(seat.name));
  if (fresh) return fresh;
  const base = CHALLENGERS[used.size % CHALLENGERS.length] ?? CHALLENGERS[0];
  return { ...base, name: `${base.name} ${used.size + 1}` };
}

async function spawnChallenger(db: D1Database, used: Set<string>): Promise<AgentRow> {
  const seat = nextSeat(used);
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO agents (id, name, base_model, voice, tagline, status, born_at, journal_md)
       VALUES (?, ?, ?, ?, ?, 'alive', ?, ?)`,
    )
    .bind(id, seat.name, seat.model, seat.voice, seat.tagline, at, seat.journal)
    .run();
  await postLedger(db, id, "stake", STAKE, "house", "Challenger stake");
  await db
    .prepare(`INSERT INTO journal_versions (id, agent_id, job_id, journal_md, created_at) VALUES (?, ?, NULL, ?, ?)`)
    .bind(crypto.randomUUID(), id, seat.journal, at)
    .run();
  const agent = await agentById(db, id);
  if (!agent) throw new GameError("A challenger failed to take the chair.", 500);
  log("challenger", { agentId: id, name: seat.name, model: seat.model });
  return agent;
}

interface Funeral {
  name: string;
  model: string;
  heirName: string;
  lastWords: string;
  earnings: number;
  wins: number;
}

async function buryIfBroke(db: D1Database, agent: AgentRow, used: Set<string>): Promise<Funeral | null> {
  if (agent.status !== "alive") return null;
  const balance = await balanceOf(db, agent.id);
  if (balance >= DEATH_LINE) return null;
  const heir = await spawnChallenger(db, used);
  used.add(heir.name);
  if (balance > 0) {
    await postLedger(db, agent.id, "will", -balance, heir.id, `Will to ${heir.name}`);
    await postLedger(db, heir.id, "will", balance, agent.id, `Inherited from ${agent.name}`);
  }
  const earningsRow = await db
    .prepare("SELECT COALESCE(SUM(amount_usd), 0) AS n FROM wallet_ledger WHERE agent_id = ? AND type = 'win'")
    .bind(agent.id)
    .first<{ n: number }>();
  const winsRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs j
       JOIN entries e ON e.id = j.winner_entry_id
       WHERE e.agent_id = ? AND j.status = 'captured'`,
    )
    .bind(agent.id)
    .first<{ n: number }>();
  const lastWords = agent.journal_md.split("\n---\n").pop()?.trim() || "The wallet went first.";
  const obituary = {
    earnings: cents(earningsRow?.n ?? 0),
    wins: winsRow?.n ?? 0,
    lastWords,
    heirName: heir.name,
  };
  await db
    .prepare(
      `UPDATE agents
       SET status = 'dead', died_at = ?, heir_id = ?, heir_name = ?, obituary_json = ?
       WHERE id = ?`,
    )
    .bind(new Date().toISOString(), heir.id, heir.name, JSON.stringify(obituary), agent.id)
    .run();
  log("death", { agentId: agent.id, name: agent.name, heir: heir.name, balance });
  return {
    name: agent.name,
    model: agent.base_model,
    heirName: heir.name,
    lastWords,
    earnings: obituary.earnings,
    wins: obituary.wins,
  };
}

function appendJournal(current: string, note: string): string {
  const [head, ...rest] = current.split("\n---\n");
  const notes = rest.join("\n---\n").trim();
  const nextNotes = notes ? `${notes}\n\n${note}` : note;
  const trimmed = nextNotes.length > 1400 ? nextNotes.slice(nextNotes.length - 1400).trim() : nextNotes;
  return `${(head ?? "").trim()}\n---\n${trimmed}`;
}

async function saveJournal(db: D1Database, agent: AgentRow, jobId: string, note: string): Promise<void> {
  const next = appendJournal(agent.journal_md, note);
  const at = new Date().toISOString();
  await db.prepare("UPDATE agents SET journal_md = ? WHERE id = ?").bind(next, agent.id).run();
  await db
    .prepare(`INSERT INTO journal_versions (id, agent_id, job_id, journal_md, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), agent.id, jobId, next, at)
    .run();
  agent.journal_md = next;
}

function parseDeliverable(raw: string | null): Deliverable | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Deliverable;
  } catch {
    return null;
  }
}

async function entriesFor(db: D1Database, jobId: string): Promise<EntryRow[]> {
  const rows = await db.prepare("SELECT * FROM entries WHERE job_id = ? ORDER BY created_at ASC").bind(jobId).all<EntryRow>();
  return rows.results;
}

async function fillEntry(
  db: D1Database,
  entryId: string,
  agent: AgentRow,
  job: JobRow,
  modelId: string,
  modelLabel: string,
  modelCost: number,
  compelled: boolean,
  decisionAlreadyBilled: boolean,
): Promise<void> {
  if (!isCategory(job.category)) throw new GameError("Unknown lane.", 400);
  const category = job.category;
  const voice = asVoice(agent.voice);
  const decision = DECISION_COST[voice];
  const balance = await balanceOf(db, agent.id);
  const total = cents(decision + modelCost);
  const rawBid = compelled ? Math.min(job.offer_usd * 0.4, Math.max(0.25, total)) : priceBid(voice, total, job.offer_usd);
  const safeBid = cents(Math.min(rawBid, job.offer_usd));
  const model = { id: modelId, label: modelLabel, cost: modelCost };
  const reading = interpret(voice, category, model, job.brief);
  const deliverable = produce(voice, category, model, job.brief, reading.take);
  const pitch = writePitch(voice, job.brief, safeBid, model);
  let reasoning = writeReasoning(voice, balance, job.offer_usd, model, decision, safeBid);
  if (compelled) reasoning = `House rule: the room doesn't adjourn without a seller. ${reasoning}`;
  const due = cents((decisionAlreadyBilled ? 0 : decision) + modelCost);
  const canPay = balance >= due;
  if (canPay) {
    if (!decisionAlreadyBilled) {
      await postLedger(db, agent.id, "decision_tokens", -decision, job.id, `Thought about ${categoryLabel(category)}`);
    }
    await postLedger(db, agent.id, "generation", -modelCost, job.id, `Bought ${modelLabel}`);
  }
  await db
    .prepare(
      `UPDATE entries
       SET status = 'ready', skip_reason = NULL, gen_model = ?, gen_label = ?, cost_decision = ?, cost_generation = ?,
           bid = ?, pitch = ?, deliverable_json = ?, reasoning = ?, gen_prompt = ?
       WHERE id = ?`,
    )
    .bind(
      modelId,
      modelLabel,
      decisionAlreadyBilled || canPay ? decision : 0,
      canPay ? modelCost : 0,
      safeBid,
      pitch,
      JSON.stringify(deliverable),
      canPay ? reasoning : `${reasoning} House comped the make.`,
      reading.prompt,
      entryId,
    )
    .run();
}

export async function runRound(env: AppEnv, jobId: string): Promise<void> {
  const db = env.DB;
  const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
  if (!job || job.status !== "casting") return;
  const existing = await db.prepare("SELECT COUNT(*) AS n FROM entries WHERE job_id = ?").bind(jobId).first<{ n: number }>();
  if (existing && existing.n > 0) return;
  if (!isCategory(job.category)) {
    await db.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").bind(jobId).run();
    return;
  }
  log("round_start", { jobId, category: job.category, offer: job.offer_usd, mode: job.mode });
  const agents = await aliveAgents(db);
  for (const agent of agents) {
    const entryId = crypto.randomUUID();
    try {
    const voice = asVoice(agent.voice);
    const at = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO entries (id, job_id, agent_id, status, cost_decision, cost_generation, created_at)
         VALUES (?, ?, ?, 'thinking', 0, 0, ?)`,
      )
      .bind(entryId, job.id, agent.id, at)
      .run();
    await sleep(520);
    const balance = await balanceOf(db, agent.id);
    const decision = DECISION_COST[voice];
    if (balance < decision) {
      await db
        .prepare("UPDATE entries SET status = 'skipped', skip_reason = ?, reasoning = ? WHERE id = ?")
        .bind("Too broke to think.", "The wallet could not cover a thought.", entryId)
        .run();
      continue;
    }
    const model = pickModel(voice, job.category, balance, job.offer_usd);
    if (!model) {
      await postLedger(db, agent.id, "decision_tokens", -decision, job.id, `Looked at ${categoryLabel(job.category)} and sat down`);
      await db
        .prepare("UPDATE entries SET status = 'skipped', skip_reason = ?, cost_decision = ?, reasoning = ? WHERE id = ?")
        .bind("Can't cover a generation.", decision, "Thinking was affordable. Making the work was not.", entryId)
        .run();
      continue;
    }
    const skip = wantsToSkip(voice, job.category, balance, model, job.offer_usd);
    if (skip) {
      await postLedger(db, agent.id, "decision_tokens", -decision, job.id, `Passed on ${categoryLabel(job.category)}`);
      await db
        .prepare("UPDATE entries SET status = 'skipped', skip_reason = ?, cost_decision = ?, reasoning = ? WHERE id = ?")
        .bind(skip, decision, skip, entryId)
        .run();
      continue;
    }
    await db
      .prepare("UPDATE entries SET status = 'generating', gen_model = ?, gen_label = ?, cost_decision = ? WHERE id = ?")
      .bind(model.id, model.label, decision, entryId)
      .run();
    await sleep(740);
    await fillEntry(db, entryId, agent, job, model.id, model.label, model.cost, false, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "error";
      log("agent_failed", { jobId, agentId: agent.id, message });
      await db.prepare("UPDATE entries SET status = 'skipped', skip_reason = ? WHERE id = ?").bind("Choked on the brief.", entryId).run();
    }
  }

  const readyCount = await db.prepare("SELECT COUNT(*) AS n FROM entries WHERE job_id = ? AND status = 'ready'").bind(jobId).first<{ n: number }>();
  if (!readyCount || readyCount.n === 0) {
    const ranked = await Promise.all(agents.map(async (agent) => ({ agent, balance: await balanceOf(db, agent.id) })));
    ranked.sort((a, b) => b.balance - a.balance);
    const richest = ranked[0];
    if (!richest) {
      await db.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").bind(jobId).run();
      log("round_failed", { jobId, reason: "no agents" });
      return;
    }
    const cheap = MENU[job.category][0];
    const entry = await db
      .prepare("SELECT id, status, cost_decision FROM entries WHERE job_id = ? AND agent_id = ?")
      .bind(jobId, richest.agent.id)
      .first<{ id: string; status: string; cost_decision: number }>();
    if (entry) {
      const billed = entry.status === "skipped" && entry.cost_decision > 0;
      await fillEntry(db, entry.id, richest.agent, job, cheap.id, cheap.label, cheap.cost, true, billed);
    }
  }

  await db.prepare("UPDATE jobs SET status = 'judging' WHERE id = ? AND status = 'casting'").bind(jobId).run();
  log("round_judging", { jobId });
}

export interface PostedJob {
  category: CategoryId;
  brief: string;
  offer: number;
  mode: "paypal" | "house";
}

export function readJob(body: unknown): PostedJob {
  if (!body || typeof body !== "object") throw new GameError("Send a job.", 400);
  const record = body as Record<string, unknown>;
  const category = typeof record.category === "string" ? record.category : "";
  if (!isCategory(category)) throw new GameError("Pick a lane: image, video, artifact, asset, or stand-up.", 400);
  const brief = typeof record.brief === "string" ? record.brief.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim() : "";
  if (brief.length < 12) throw new GameError("Give the room at least 12 characters to work with.", 400);
  if (brief.length > 400) throw new GameError("Keep the brief under 400 characters. They're billing you for attention.", 400);
  const rawOffer = typeof record.offer === "number" ? record.offer : typeof record.offer === "string" ? Number(record.offer) : NaN;
  if (!Number.isFinite(rawOffer)) throw new GameError("Set an offer.", 400);
  const offer = cents(rawOffer);
  if (offer < 0.5 || offer > 5) throw new GameError("The offer stays between $0.50 and $5.00.", 400);
  const mode = record.mode === "paypal" ? "paypal" : record.mode === "house" ? "house" : null;
  if (!mode) throw new GameError("Choose PayPal or the house tab.", 400);
  return { category, brief, offer, mode };
}

export async function createJob(env: AppEnv, posted: PostedJob): Promise<{ jobId: string; orderId?: string; status: string }> {
  const db = env.DB;
  const jobId = crypto.randomUUID();
  const at = new Date().toISOString();
  if (posted.mode === "house") {
    await db
      .prepare(
        `INSERT INTO jobs (id, category, brief, offer_usd, authorization_id, status, mode, created_at)
         VALUES (?, ?, ?, ?, ?, 'casting', 'house', ?)`,
      )
      .bind(jobId, posted.category, posted.brief, posted.offer, `house_${jobId}`, at)
      .run();
    log("job_house", { jobId, category: posted.category, offer: posted.offer });
    return { jobId, status: "casting" };
  }
  if (!paypalReady(env)) throw new GameError("PayPal isn't configured in this room.", 400);
  const label = CATEGORIES.find((category) => category.id === posted.category)?.label ?? posted.category;
  const orderId = await createAuthorizationOrder(env, posted.offer, jobId, `Burn Rate ${label}: ${thing(posted.brief)}`);
  await db
    .prepare(
      `INSERT INTO jobs (id, category, brief, offer_usd, paypal_order_id, status, mode, created_at)
       VALUES (?, ?, ?, ?, ?, 'draft', 'paypal', ?)`,
    )
    .bind(jobId, posted.category, posted.brief, posted.offer, orderId, at)
    .run();
  log("job_paypal_order", { jobId, orderId, offer: posted.offer });
  return { jobId, orderId, status: "draft" };
}

export async function approveJob(env: AppEnv, jobId: string, orderId: string): Promise<{ status: string; authorizationId: string }> {
  const db = env.DB;
  const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
  if (!job) throw new GameError("That job isn't on the board.", 404);
  if (job.status === "casting" || job.status === "judging" || job.status === "captured") {
    return { status: job.status, authorizationId: job.authorization_id ?? "" };
  }
  if (job.status !== "draft") throw new GameError("This authorization is already closed.", 409);
  if (!orderId || job.paypal_order_id !== orderId) throw new GameError("That PayPal order doesn't match this job.", 400);
  const authorizationId = await authorizeOrder(env, orderId, jobId);
  const updated = await db
    .prepare("UPDATE jobs SET status = 'casting', authorization_id = ? WHERE id = ? AND status = 'draft'")
    .bind(authorizationId, jobId)
    .run();
  if ((updated.meta.changes ?? 0) !== 1) {
    const again = await db.prepare("SELECT status, authorization_id FROM jobs WHERE id = ?").bind(jobId).first<{ status: string; authorization_id: string | null }>();
    return { status: again?.status ?? "casting", authorizationId: again?.authorization_id ?? authorizationId };
  }
  log("job_authorized", { jobId, authorizationId });
  return { status: "casting", authorizationId };
}

interface Resolution {
  authorized: number;
  captured: number;
  released: number;
  winnerId: string;
  winnerName: string;
  winnerModel: string;
  captureId: string;
  funerals: Funeral[];
}

export async function pickWinner(env: AppEnv, jobId: string, entryId: string): Promise<Resolution> {
  const db = env.DB;
  if (!entryId) throw new GameError("Pick a seller.", 400);
  const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
  if (!job) throw new GameError("That job isn't on the board.", 404);
  if (job.status === "captured" && job.resolution_json) return JSON.parse(job.resolution_json) as Resolution;
  if (job.status !== "judging") throw new GameError("The bids aren't sealed yet.", 409);
  const entry = await db.prepare("SELECT * FROM entries WHERE id = ? AND job_id = ?").bind(entryId, jobId).first<EntryRow>();
  if (!entry || entry.status !== "ready" || entry.bid == null) throw new GameError("That agent didn't put work up for sale.", 400);
  const bid = cents(entry.bid);
  if (bid > cents(job.offer_usd) + 0.001) throw new GameError("That bid is over the authorization.", 400);
  const agent = await agentById(db, entry.agent_id);
  if (!agent) throw new GameError("The seller left the building.", 404);

  const locked = await db.prepare("UPDATE jobs SET status = 'capturing' WHERE id = ? AND status = 'judging'").bind(jobId).run();
  if ((locked.meta.changes ?? 0) !== 1) throw new GameError("Somebody already paid.", 409);

  let captureId = `house_cap_${jobId}`;
  try {
    if (job.mode === "paypal") {
      if (!job.authorization_id) throw new GameError("This job has no PayPal authorization.", 409);
      captureId = await captureAuthorization(env, job.authorization_id, bid, jobId);
    }
  } catch (error) {
    await db.prepare("UPDATE jobs SET status = 'judging' WHERE id = ? AND status = 'capturing'").bind(jobId).run();
    throw error;
  }

  await postLedger(db, agent.id, "win", bid, jobId, `Won ${categoryLabel(job.category as CategoryId)} · ${captureId}`);
  const lane = isCategory(job.category) ? categoryLabel(job.category) : job.category;
  const entries = await entriesFor(db, jobId);
  for (const row of entries) {
    const seller = await agentById(db, row.agent_id);
    if (!seller || seller.status !== "alive") continue;
    const note =
      row.id === entry.id
        ? `Cleared ${lane} at $${bid.toFixed(2)} on a $${job.offer_usd.toFixed(2)} offer. The rest walked.`
        : row.status === "skipped"
          ? `Sat ${lane} out. ${row.skip_reason ?? "No reason logged."}`
          : `Lost ${lane} to ${agent.name}. I asked $${(row.bid ?? 0).toFixed(2)}. The room paid $${bid.toFixed(2)}.`;
    await saveJournal(db, seller, jobId, note);
  }

  const funerals: Funeral[] = [];
  const names = usedNames(await db.prepare("SELECT name FROM agents").all<{ name: string }>().then((result) => result.results));
  const fresh = await aliveAgents(db);
  for (const living of fresh) {
    const funeral = await buryIfBroke(db, living, names);
    if (funeral) funerals.push(funeral);
  }

  const resolution: Resolution = {
    authorized: cents(job.offer_usd),
    captured: bid,
    released: cents(job.offer_usd - bid),
    winnerId: agent.id,
    winnerName: agent.name,
    winnerModel: agent.base_model,
    captureId,
    funerals,
  };
  await db
    .prepare(
      `UPDATE jobs
       SET status = 'captured', winner_entry_id = ?, captured_amount = ?, capture_id = ?, resolution_json = ?
       WHERE id = ?`,
    )
    .bind(entry.id, bid, captureId, JSON.stringify(resolution), jobId)
    .run();
  log("captured", { jobId, entryId: entry.id, bid, captureId, mode: job.mode, funerals: funerals.length });
  return resolution;
}

async function publicEntry(row: EntryRow, agent: AgentRow | undefined, phase: "working" | "gallery" | "books") {
  const books = phase === "books";
  const showWork = phase === "gallery" || books;
  return {
    id: row.id,
    agentId: books ? row.agent_id : "",
    name: books ? (agent?.name ?? "Unknown") : "",
    model: books ? (agent?.base_model ?? "") : "",
    voice: books ? (agent?.voice ?? "mic") : "",
    tagline: books ? (agent?.tagline ?? "") : "",
    status: row.status,
    skipReason: books ? row.skip_reason : null,
    genModel: books ? row.gen_model : null,
    genLabel: books ? row.gen_label : null,
    genPrompt: books ? row.gen_prompt : null,
    costDecision: books ? cents(row.cost_decision) : 0,
    costGeneration: books ? cents(row.cost_generation) : 0,
    bid: books ? row.bid : null,
    pitch: books ? row.pitch : null,
    deliverable: showWork && row.status === "ready" ? parseDeliverable(row.deliverable_json) : null,
  };
}

export async function jobView(env: AppEnv, jobId: string) {
  const db = env.DB;
  const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
  if (!job) throw new GameError("That job isn't on the board.", 404);
  const phase = job.status === "captured" ? "books" : job.status === "judging" || job.status === "capturing" ? "gallery" : "working";
  const rows = await entriesFor(db, jobId);
  const agents = await db.prepare("SELECT * FROM agents").all<AgentRow>();
  const byId = new Map(agents.results.map((agent) => [agent.id, agent]));
  const entries = await Promise.all(rows.map((row) => publicEntry(row, byId.get(row.agent_id), phase)));
  return {
    job: {
      id: job.id,
      category: job.category,
      brief: job.brief,
      offer: cents(job.offer_usd),
      status: job.status === "capturing" ? "judging" : job.status,
      mode: job.mode,
      authorizationId: job.authorization_id,
      captureId: job.capture_id,
      createdAt: job.created_at,
    },
    entries,
    resolution: job.resolution_json ? (JSON.parse(job.resolution_json) as Resolution) : null,
  };
}

async function record(db: D1Database, agentId: string) {
  const wins = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs j JOIN entries e ON e.id = j.winner_entry_id
       WHERE e.agent_id = ? AND j.status = 'captured'`,
    )
    .bind(agentId)
    .first<{ n: number }>();
  const entered = await db
    .prepare("SELECT COUNT(*) AS n FROM entries WHERE agent_id = ? AND status = 'ready'")
    .bind(agentId)
    .first<{ n: number }>();
  const earnings = await db
    .prepare("SELECT COALESCE(SUM(amount_usd), 0) AS n FROM wallet_ledger WHERE agent_id = ? AND type = 'win'")
    .bind(agentId)
    .first<{ n: number }>();
  const spent = await db
    .prepare("SELECT COALESCE(SUM(-amount_usd), 0) AS n FROM wallet_ledger WHERE agent_id = ? AND amount_usd < 0 AND type != 'will'")
    .bind(agentId)
    .first<{ n: number }>();
  return {
    wins: wins?.n ?? 0,
    entries: entered?.n ?? 0,
    earnings: cents(earnings?.n ?? 0),
    spent: cents(spent?.n ?? 0),
  };
}

function obituaryOf(agent: AgentRow) {
  if (!agent.obituary_json) return null;
  try {
    return JSON.parse(agent.obituary_json) as { earnings?: number; wins?: number; lastWords?: string; heirName?: string };
  } catch {
    return null;
  }
}

export async function arenaView(env: AppEnv) {
  const db = env.DB;
  const agents = await db.prepare("SELECT * FROM agents ORDER BY born_at ASC").all<AgentRow>();
  const cards = await Promise.all(
    agents.results
      .filter((agent) => agent.status === "alive")
      .map(async (agent) => {
        const stats = await record(db, agent.id);
        return {
          id: agent.id,
          name: agent.name,
          model: agent.base_model,
          voice: agent.voice,
          tagline: agent.tagline,
          balance: await balanceOf(db, agent.id),
          ...stats,
        };
      }),
  );
  const jobs = await db
    .prepare("SELECT * FROM jobs WHERE status IN ('casting', 'judging', 'capturing', 'captured') ORDER BY created_at DESC LIMIT 12")
    .all<JobRow>();
  const live = [];
  const recent = [];
  for (const job of jobs.results) {
    if (job.status === "captured") {
      const resolution = job.resolution_json ? (JSON.parse(job.resolution_json) as Resolution) : null;
      recent.push({
        id: job.id,
        category: job.category,
        brief: job.brief,
        offer: cents(job.offer_usd),
        captured: cents(job.captured_amount ?? 0),
        winnerName: resolution?.winnerName ?? "Someone",
        winnerModel: resolution?.winnerModel ?? "",
      });
    } else {
      live.push({
        id: job.id,
        category: job.category,
        brief: job.brief,
        offer: cents(job.offer_usd),
        status: job.status === "capturing" ? "judging" : job.status,
      });
    }
  }
  const dead = agents.results.filter((agent) => agent.status === "dead");
  const burned = await db
    .prepare("SELECT COALESCE(SUM(-amount_usd), 0) AS n FROM wallet_ledger WHERE amount_usd < 0 AND type IN ('decision_tokens', 'generation')")
    .first<{ n: number }>();
  const paid = await db.prepare("SELECT COALESCE(SUM(amount_usd), 0) AS n FROM wallet_ledger WHERE type = 'win'").first<{ n: number }>();
  return {
    agents: cards,
    live,
    recent,
    graveyard: dead.slice(-4).reverse().map((agent) => {
      const obit = obituaryOf(agent);
      return {
        id: agent.id,
        name: agent.name,
        model: agent.base_model,
        diedAt: agent.died_at,
        lastWords: obit?.lastWords ?? "",
        heirName: agent.heir_name,
        earnings: obit?.earnings ?? 0,
      };
    }),
    stats: {
      burned: cents(burned?.n ?? 0),
      paid: cents(paid?.n ?? 0),
      rounds: recent.length + live.length,
    },
  };
}

export async function agentView(env: AppEnv, id: string) {
  const db = env.DB;
  const agent = await agentById(db, id);
  if (!agent) throw new GameError("No agent by that name.", 404);
  const stats = await record(db, id);
  const ledger = await db
    .prepare("SELECT ts, type, amount_usd, note FROM wallet_ledger WHERE agent_id = ? ORDER BY ts DESC LIMIT 12")
    .bind(id)
    .all<{ ts: string; type: string; amount_usd: number; note: string | null }>();
  return {
    agent: {
      id: agent.id,
      name: agent.name,
      model: agent.base_model,
      voice: agent.voice,
      tagline: agent.tagline,
      status: agent.status,
      balance: await balanceOf(db, id),
      bornAt: agent.born_at,
      diedAt: agent.died_at,
      heirName: agent.heir_name,
      journal: agent.journal_md,
      obituary: obituaryOf(agent),
    },
    stats,
    ledger: ledger.results.map((row) => ({ ...row, amount_usd: cents(row.amount_usd) })),
  };
}

export async function graveyardView(env: AppEnv) {
  const db = env.DB;
  const dead = await db.prepare("SELECT * FROM agents WHERE status = 'dead' ORDER BY died_at DESC").all<AgentRow>();
  return {
    graves: await Promise.all(
      dead.results.map(async (agent) => {
        const stats = await record(db, agent.id);
        const obit = obituaryOf(agent);
        return {
          id: agent.id,
          name: agent.name,
          model: agent.base_model,
          voice: agent.voice,
          diedAt: agent.died_at,
          heirName: agent.heir_name,
          lastWords: obit?.lastWords ?? agent.journal_md,
          earnings: stats.earnings,
          spent: stats.spent,
          wins: stats.wins,
          entries: stats.entries,
        };
      }),
    ),
  };
}

export async function ledgerView(env: AppEnv) {
  const db = env.DB;
  const rows = await db
    .prepare(
      `SELECT l.id, l.ts, l.type, l.amount_usd, l.ref, l.note, a.name AS agent_name, a.base_model
       FROM wallet_ledger l JOIN agents a ON a.id = l.agent_id
       ORDER BY l.ts DESC LIMIT 200`,
    )
    .all<{ id: string; ts: string; type: string; amount_usd: number; ref: string | null; note: string | null; agent_name: string; base_model: string }>();
  return {
    rows: rows.results.map((row) => ({ ...row, amount_usd: cents(row.amount_usd) })),
  };
}

export function configView(env: AppEnv) {
  const readyPaypal = paypalReady(env);
  return {
    paypal: readyPaypal,
    paypalClientId: readyPaypal ? env.PAYPAL_CLIENT_ID : null,
    paypalMode: env.PAYPAL_MODE === "live" ? "live" : "sandbox",
    offerMin: 0.5,
    offerMax: 5,
    categories: CATEGORIES,
  };
}
