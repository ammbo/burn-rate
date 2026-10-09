import {
  CATEGORIES,
  CHALLENGERS,
  DEATH_LINE,
  MAKERS,
  MENU,
  OPENING,
  STAKE,
  asVoice,
  categoryLabel,
  cents,
  clampMoney,
  isCategory,
  makerFor,
  priceBid,
  seatNamed,
  type CategoryId,
  type Maker,
  type MakerKind,
  type Seat,
} from "./catalog";
import { GameError } from "./errors";
import { ACCESS_SCHEMA, assertGenerationEnabled, assertOwner, emailConfigured, generationEnabled, generationLimits, notifyOffersReady, type AccessEnv } from "./access";
import { plan, write, type Persona } from "./ai";
import { fromMedia, fromWriting, interpret, produce, thing, writePitch, writeReasoning, type Deliverable } from "./make";
import { downloadVideo, image, pollVideo, submitVideo, type OpenRouterEnv, type VideoJob } from "./openrouter";
import { authorizeOrder, captureAuthorization, createAuthorizationOrder, paypalReady, paypalMode, type PaypalEnv } from "./paypal";

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
  ...ACCESS_SCHEMA,
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
  brain_model: string | null;
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
  owner_session_id: string | null;
  round_started_at?: string | null;
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

export type AppEnv = Env & PaypalEnv & AccessEnv & OpenRouterEnv;

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ensureReady(db: D1Database): Promise<void> {
  return (async () => {
    try {
      const version = await db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").first<{ value: string }>();
      if (version?.value === "4") return;
    } catch (error) {
      if (!(error instanceof Error) || !/no such table/i.test(error.message)) throw error;
    }
    await migrateAndSeed(db);
    await db.prepare("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
    await db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '4')").run();
  })();
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
  await ensureColumn(db, "jobs", "owner_session_id", "TEXT");
  await ensureColumn(db, "jobs", "round_started_at", "TEXT");
  await ensureColumn(db, "access_sessions", "user_id", "TEXT");
  await ensureColumn(db, "jobs", "round_token", "TEXT");
  await ensureColumn(db, "agents", "brain_model", "TEXT");
  const unassigned = await db.prepare("SELECT id, name FROM agents WHERE brain_model IS NULL").all<{ id: string; name: string }>();
  for (const agent of unassigned.results) {
    const seat = seatNamed(agent.name) ?? OPENING[3];
    await db.prepare("UPDATE agents SET base_model = ?, brain_model = ? WHERE id = ?").bind(seat.model, seat.brain, agent.id).run();
  }
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
          `INSERT INTO agents (id, name, base_model, brain_model, voice, tagline, status, born_at, journal_md)
           VALUES (?, ?, ?, ?, ?, ?, 'alive', ?, ?)`,
        )
        .bind(id, seat.name, seat.model, seat.brain, seat.voice, seat.tagline, at, seat.journal),
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

async function postLedger(db: D1Database, agentId: string, type: string, amount: number, ref: string, note: string, id = crypto.randomUUID()): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO wallet_ledger (id, agent_id, ts, type, amount_usd, ref, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, agentId, new Date().toISOString(), type, Math.round(amount * 10000) / 10000, ref, note)
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
      `INSERT INTO agents (id, name, base_model, brain_model, voice, tagline, status, born_at, journal_md)
       VALUES (?, ?, ?, ?, ?, ?, 'alive', ?, ?)`,
    )
    .bind(id, seat.name, seat.model, seat.brain, seat.voice, seat.tagline, at, seat.journal)
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

const THINK_FLOOR = 0.02;
const VIDEO_POLLS = 40;
const VIDEO_WAIT_MS = 15_000;
const NOTIFY_AFTER_MS = 60_000;

export interface Steps {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(name: string, ms: number): Promise<void>;
}

const inline: Steps = { do: (_name, fn) => fn(), sleep: (_name, ms) => sleep(ms) };

interface Cast {
  entryId: string;
  agentId: string;
}

type Planned = { go: false } | { go: true; makerId: string; kind: MakerKind; prompt: string; take: string };

function personaOf(agent: AgentRow): Persona {
  const seat = seatNamed(agent.name);
  return {
    name: agent.name,
    brain: agent.brain_model ?? seat?.brain ?? OPENING[3].brain,
    brainLabel: agent.base_model,
    voice: asVoice(agent.voice),
    tagline: agent.tagline,
    journal: agent.journal_md,
  };
}

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

const usd4 = (value: number) => `$${value.toFixed(value < 0.1 ? 3 : 2)}`;

async function historyFor(db: D1Database, agentId: string, balance: number): Promise<string> {
  const stats = await record(db, agentId);
  const mine = await db
    .prepare(
      `SELECT j.category, j.offer_usd, e.status, e.skip_reason, e.gen_label, e.bid, e.cost_decision + e.cost_generation AS spent,
              j.captured_amount, (j.winner_entry_id = e.id) AS won, w.gen_label AS win_label, wa.base_model AS win_model
       FROM entries e JOIN jobs j ON j.id = e.job_id
       LEFT JOIN entries w ON w.id = j.winner_entry_id LEFT JOIN agents wa ON wa.id = w.agent_id
       WHERE e.agent_id = ? AND j.status = 'captured'
       ORDER BY j.created_at DESC LIMIT 6`,
    )
    .bind(agentId)
    .all<{ category: string; offer_usd: number; status: string; skip_reason: string | null; gen_label: string | null; bid: number | null; spent: number; captured_amount: number | null; won: number; win_label: string | null; win_model: string | null }>();
  const market = await db
    .prepare(
      `SELECT j.category, j.offer_usd, j.captured_amount, w.gen_label, a.base_model,
              (SELECT COUNT(*) FROM entries x WHERE x.job_id = j.id AND x.status = 'ready') AS sellers
       FROM jobs j JOIN entries w ON w.id = j.winner_entry_id JOIN agents a ON a.id = w.agent_id
       WHERE j.status = 'captured' ORDER BY j.created_at DESC LIMIT 6`,
    )
    .all<{ category: string; offer_usd: number; captured_amount: number | null; gen_label: string | null; base_model: string; sellers: number }>();
  const lines = [
    `You: wallet ${usd4(balance)}, ${stats.wins} wins in ${stats.entries} entries, earned ${usd4(stats.earnings)}, spent ${usd4(stats.spent)}.`,
  ];
  if (mine.results.length === 0) lines.push("Your recent rounds: none settled yet.");
  for (const row of mine.results) {
    const lane = isCategory(row.category) ? categoryLabel(row.category) : row.category;
    if (row.status === "skipped") {
      lines.push(`- ${lane}, offer $${row.offer_usd.toFixed(2)}: you skipped (${row.skip_reason ?? "no reason"}). Winner: ${row.win_model ?? "?"} with ${row.win_label ?? "?"} at $${(row.captured_amount ?? 0).toFixed(2)}.`);
    } else if (row.won) {
      lines.push(`- ${lane}, offer $${row.offer_usd.toFixed(2)}: you WON with ${row.gen_label ?? "?"} at $${(row.bid ?? 0).toFixed(2)}, spent ${usd4(row.spent)}.`);
    } else {
      lines.push(`- ${lane}, offer $${row.offer_usd.toFixed(2)}: you LOST bidding $${(row.bid ?? 0).toFixed(2)} with ${row.gen_label ?? "?"} (spent ${usd4(row.spent)}). Winner: ${row.win_model ?? "?"} with ${row.win_label ?? "?"} at $${(row.captured_amount ?? 0).toFixed(2)}.`);
    }
  }
  if (market.results.length > 0) {
    lines.push("Recent winning sales in the room:");
    for (const row of market.results) {
      const lane = isCategory(row.category) ? categoryLabel(row.category) : row.category;
      lines.push(`- ${lane}: ${row.base_model} won with ${row.gen_label ?? "?"} at $${(row.captured_amount ?? 0).toFixed(2)} of $${row.offer_usd.toFixed(2)}, against ${Math.max(0, row.sellers - 1)} other sellers.`);
    }
  }
  return lines.join("\n");
}

async function loadRound(db: D1Database, jobId: string, cast: Cast) {
  const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
  const agent = await agentById(db, cast.agentId);
  if (!job || !agent || !isCategory(job.category)) throw new Error("Round state is missing.");
  return { job, agent, category: job.category };
}

async function skipEntry(db: D1Database, entryId: string, reason: string, decision?: number): Promise<void> {
  if (decision === undefined) {
    await db.prepare("UPDATE entries SET status = 'skipped', skip_reason = ?, reasoning = COALESCE(reasoning, ?) WHERE id = ?").bind(reason, reason, entryId).run();
  } else {
    await db.prepare("UPDATE entries SET status = 'skipped', skip_reason = ?, reasoning = COALESCE(reasoning, ?), cost_decision = ? WHERE id = ?").bind(reason, reason, decision, entryId).run();
  }
}

async function startRound(env: AppEnv, jobId: string, token: string): Promise<Cast[] | null> {
  assertGenerationEnabled(env);
  const db = env.DB;
  const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
  if (!job || job.status !== "casting") return null;
  const reserved = await db.prepare("SELECT job_id FROM generation_requests WHERE job_id = ?").bind(jobId).first();
  if (!reserved) throw new GameError("This round has no generation allowance.", 403);
  const claimed = await db
    .prepare(
      `UPDATE jobs SET round_started_at = COALESCE(round_started_at, ?), round_token = ?
       WHERE id = ? AND status = 'casting' AND ((round_started_at IS NULL AND round_token IS NULL) OR round_token = ?)`,
    )
    .bind(new Date().toISOString(), token, jobId, token)
    .run();
  if (claimed.meta.changes !== 1) return null;
  if (!isCategory(job.category)) {
    await db.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").bind(jobId).run();
    return null;
  }
  const existing = await db.prepare("SELECT id AS entryId, agent_id AS agentId FROM entries WHERE job_id = ? ORDER BY created_at ASC").bind(jobId).all<Cast>();
  if (existing.results.length > 0) return existing.results;
  log("round_start", { jobId, category: job.category, offer: job.offer_usd, mode: job.mode });
  const agents = (await aliveAgents(db)).slice(0, 4);
  const cast = agents.map((agent) => ({ entryId: crypto.randomUUID(), agentId: agent.id }));
  const at = Date.now();
  await db.batch(
    cast.map((seat, index) =>
      db
        .prepare(
          `INSERT INTO entries (id, job_id, agent_id, status, cost_decision, cost_generation, created_at)
           VALUES (?, ?, ?, 'thinking', 0, 0, ?)`,
        )
        .bind(seat.entryId, jobId, seat.agentId, new Date(at + index).toISOString()),
    ),
  );
  return cast;
}

async function planEntry(env: AppEnv, jobId: string, cast: Cast): Promise<Planned> {
  const db = env.DB;
  const { job, agent, category } = await loadRound(db, jobId, cast);
  const lane = categoryLabel(category);
  const balance = await balanceOf(db, agent.id);
  if (balance < THINK_FLOOR) {
    await skipEntry(db, cast.entryId, "Too broke to think.");
    return { go: false };
  }
  const down = await db
    .prepare(
      `SELECT DISTINCT e.gen_model FROM entries e JOIN jobs j ON j.id = e.job_id
       WHERE e.status = 'skipped' AND e.skip_reason LIKE '% render failed.' AND j.created_at > ?`,
    )
    .bind(new Date(Date.now() - 30 * 60_000).toISOString())
    .all<{ gen_model: string | null }>();
  const failing = new Set(down.results.map((row) => row.gen_model));
  const working = MAKERS[category].filter((maker) => !failing.has(maker.id));
  const menu = working.length > 0 ? working : MAKERS[category];
  let result;
  try {
    result = await plan(env, personaOf(agent), category, lane, job.brief, job.offer_usd, balance, menu, await historyFor(db, agent.id, balance));
  } catch (error) {
    log("plan_failed", { jobId, agentId: agent.id, model: agent.brain_model, message: error instanceof Error ? error.message : "error" });
    await skipEntry(db, cast.entryId, "Froze at the brief. The model didn't answer.");
    return { go: false };
  }
  const thinking = Math.max(0, result.cost ?? 0.01);
  await postLedger(db, agent.id, "decision_tokens", -thinking, job.id, `${agent.base_model} thought about ${lane}`, `${cast.entryId}:think`);
  const p = result.value;
  const reason = clip(p.reason, 240);
  const choice = clip(p.choice, 120);
  if (choice.toLowerCase() === "skip") {
    await skipEntry(db, cast.entryId, reason || "Sat this one out.", thinking);
    return { go: false };
  }
  const maker = makerFor(category, choice) ?? menu.find((option) => option.label.toLowerCase() === choice.toLowerCase());
  if (!maker) {
    await skipEntry(db, cast.entryId, `Asked for ${choice || "nothing"}, which isn't on the menu.`, thinking);
    return { go: false };
  }
  if (balance - thinking < maker.estimate) {
    await skipEntry(db, cast.entryId, `Wanted ${maker.label} and couldn't cover it.`, thinking);
    return { go: false };
  }
  const prompt = clip(p.prompt, 1500);
  if (!prompt) {
    await skipEntry(db, cast.entryId, "Hired a model and forgot to brief it.", thinking);
    return { go: false };
  }
  const rawBid = Number(p.bid);
  const bid = clampMoney(Number.isFinite(rawBid) && rawBid > 0 ? rawBid : maker.estimate * 2, Math.min(0.05, job.offer_usd), job.offer_usd);
  const take = clip(p.take, 90) || thing(job.brief);
  const pitch = clip(p.pitch, 300) || writePitch(asVoice(agent.voice), job.brief, bid, MENU[category][0]);
  const reasoning = [reason, clip(p.reasoning, 400)].filter(Boolean).join(" ");
  await db
    .prepare(
      `UPDATE entries SET status = 'generating', gen_model = ?, gen_label = ?, cost_decision = ?, bid = ?, pitch = ?, reasoning = ?, gen_prompt = ?
       WHERE id = ?`,
    )
    .bind(maker.id, maker.label, thinking, bid, pitch, reasoning, prompt, cast.entryId)
    .run();
  return { go: true, makerId: maker.id, kind: maker.kind, prompt, take };
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp", "image/svg+xml": "svg", "video/mp4": "mp4" };

async function store(env: AppEnv, jobId: string, entryId: string, bytes: ArrayBuffer | Uint8Array, type: string): Promise<string> {
  const ext = EXTENSIONS[type];
  if (!ext) throw new Error(`Unsupported media type ${type}`);
  await env.MEDIA.put(`jobs/${jobId}/${entryId}.${ext}`, bytes, { httpMetadata: { contentType: type } });
  return `/api/media/${jobId}/${entryId}.${ext}`;
}

async function finishEntry(db: D1Database, jobId: string, cast: Cast, maker: Maker, cost: number | null, deliverable: Deliverable): Promise<void> {
  const spent = Math.max(0, cost ?? maker.estimate);
  await postLedger(db, cast.agentId, "generation", -spent, jobId, `Hired ${maker.label}`, `${cast.entryId}:make`);
  await db
    .prepare("UPDATE entries SET status = 'ready', skip_reason = NULL, cost_generation = ?, deliverable_json = ? WHERE id = ?")
    .bind(spent, JSON.stringify(deliverable), cast.entryId)
    .run();
}

async function failEntry(db: D1Database, jobId: string, cast: Cast, maker: Maker, error: unknown): Promise<void> {
  log("make_failed", { jobId, agentId: cast.agentId, model: maker.id, message: error instanceof Error ? error.message : String(error) });
  await skipEntry(db, cast.entryId, `The ${maker.label} render failed.`);
}

async function makeEntry(env: AppEnv, jobId: string, cast: Cast, planned: Extract<Planned, { go: true }>): Promise<void> {
  const db = env.DB;
  const { job, category } = await loadRound(db, jobId, cast);
  const maker = makerFor(category, planned.makerId);
  if (!maker) throw new Error("Maker vanished from the menu.");
  try {
    if (maker.kind === "text") {
      if (category !== "artifact" && category !== "standup") throw new Error(`No writer lane for ${category}`);
      const written = await write(env, maker.id, category, job.brief, planned.prompt);
      const deliverable = fromWriting(job.brief, written.value);
      if (!deliverable) throw new Error("The writer returned an empty piece.");
      await finishEntry(db, jobId, cast, maker, written.cost, deliverable);
      return;
    }
    const picture = await image(env, maker.id, planned.prompt, category === "asset" ? "1:1" : "3:4");
    const src = await store(env, jobId, cast.entryId, picture.value.bytes, picture.value.type);
    await finishEntry(db, jobId, cast, maker, picture.cost, fromMedia(category, "image", src, planned.take, job.brief));
  } catch (error) {
    await failEntry(db, jobId, cast, maker, error);
  }
}

async function submitEntryVideo(env: AppEnv, jobId: string, cast: Cast, planned: Extract<Planned, { go: true }>): Promise<VideoJob | null> {
  const { category } = await loadRound(env.DB, jobId, cast);
  const maker = makerFor(category, planned.makerId);
  if (!maker?.video) throw new Error("Video maker vanished from the menu.");
  try {
    return await submitVideo(env, maker.id, planned.prompt, { ...maker.video, aspect: category === "standup" ? "9:16" : "16:9" });
  } catch (error) {
    await failEntry(env.DB, jobId, cast, maker, error);
    return null;
  }
}

async function storeEntryVideo(env: AppEnv, jobId: string, cast: Cast, planned: Extract<Planned, { go: true }>, state: VideoJob): Promise<void> {
  const { job, category } = await loadRound(env.DB, jobId, cast);
  const maker = makerFor(category, planned.makerId);
  if (!maker) throw new Error("Video maker vanished from the menu.");
  try {
    if (state.status !== "completed") throw new Error(state.error ?? `Video ended ${state.status}`);
    const src = await store(env, jobId, cast.entryId, await downloadVideo(env, state), "video/mp4");
    await finishEntry(env.DB, jobId, cast, maker, state.cost, fromMedia(category, "video", src, planned.take, job.brief));
  } catch (error) {
    await failEntry(env.DB, jobId, cast, maker, error);
  }
}

async function playAgent(env: AppEnv, jobId: string, cast: Cast, steps: Steps): Promise<void> {
  try {
    const planned = await steps.do(`plan:${cast.agentId}`, () => planEntry(env, jobId, cast));
    if (!planned.go) return;
    if (planned.kind !== "video") {
      await steps.do(`make:${cast.agentId}`, () => makeEntry(env, jobId, cast, planned));
      return;
    }
    let state = await steps.do(`submit:${cast.agentId}`, () => submitEntryVideo(env, jobId, cast, planned));
    if (!state) return;
    for (let i = 0; i < VIDEO_POLLS && !["completed", "failed", "cancelled", "expired"].includes(state.status); i += 1) {
      await steps.sleep(`wait:${cast.agentId}:${i}`, VIDEO_WAIT_MS);
      const previous: VideoJob = state;
      state = await steps.do(`poll:${cast.agentId}:${i}`, () => pollVideo(env, previous).catch(() => previous));
    }
    const final: VideoJob = state;
    await steps.do(`store:${cast.agentId}`, () => storeEntryVideo(env, jobId, cast, planned, final));
  } catch (error) {
    log("agent_failed", { jobId, agentId: cast.agentId, message: error instanceof Error ? error.message : "error" });
    await skipEntry(env.DB, cast.entryId, "Choked on the brief.");
  }
}

async function houseEntry(db: D1Database, entryId: string, agent: AgentRow, job: JobRow, category: CategoryId): Promise<void> {
  const voice = asVoice(agent.voice);
  const model = MENU[category][0];
  const reading = interpret(voice, category, model, job.brief);
  const bid = cents(Math.min(job.offer_usd * 0.4, Math.max(0.25, priceBid(voice, model.cost, job.offer_usd))));
  await db
    .prepare(
      `UPDATE entries SET status = 'ready', skip_reason = NULL, gen_model = ?, gen_label = ?, bid = ?, pitch = ?, deliverable_json = ?, reasoning = ?, gen_prompt = ?
       WHERE id = ?`,
    )
    .bind(
      model.id,
      `House template (${model.label})`,
      bid,
      writePitch(voice, job.brief, bid, model),
      JSON.stringify(produce(voice, category, model, job.brief, reading.take)),
      `House rule: the room doesn't adjourn without a seller. The house comped a template. ${writeReasoning(voice, 0, job.offer_usd, model, 0, bid)}`,
      reading.prompt,
      entryId,
    )
    .run();
}

async function closeRound(env: AppEnv, jobId: string): Promise<void> {
  const db = env.DB;
  const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
  if (!job || job.status !== "casting" || !isCategory(job.category)) return;
  await db.prepare("UPDATE entries SET status = 'skipped', skip_reason = 'Ran out of time.' WHERE job_id = ? AND status IN ('thinking', 'generating')").bind(jobId).run();
  const readyCount = await db.prepare("SELECT COUNT(*) AS n FROM entries WHERE job_id = ? AND status = 'ready'").bind(jobId).first<{ n: number }>();
  if (!readyCount || readyCount.n === 0) {
    const rows = await entriesFor(db, jobId);
    const ranked = await Promise.all(rows.map(async (row) => ({ row, balance: await balanceOf(db, row.agent_id) })));
    ranked.sort((a, b) => b.balance - a.balance);
    const richest = ranked[0];
    const agent = richest ? await agentById(db, richest.row.agent_id) : null;
    if (!richest || !agent) {
      await db.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").bind(jobId).run();
      log("round_failed", { jobId, reason: "no agents" });
      return;
    }
    await houseEntry(db, richest.row.id, agent, job, job.category);
  }
  const judged = await db.prepare("UPDATE jobs SET status = 'judging' WHERE id = ? AND status = 'casting'").bind(jobId).run();
  log("round_judging", { jobId });
  const started = Date.parse(job.round_started_at ?? job.created_at);
  if (judged.meta.changes === 1 && Date.now() - started >= NOTIFY_AFTER_MS) await notifyOffersReady(env, jobId);
}

export async function runRound(env: AppEnv, jobId: string, steps: Steps = inline, token = crypto.randomUUID()): Promise<void> {
  const cast = await steps.do("start", () => startRound(env, jobId, token));
  if (!cast) return;
  await Promise.all(cast.map((seat) => playAgent(env, jobId, seat, steps)));
  await steps.do("close", () => closeRound(env, jobId));
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

export async function createJob(env: AppEnv, posted: PostedJob, ownerSessionId: string, jobId: string): Promise<{ jobId: string; orderId?: string; status: string }> {
  const db = env.DB;
  const at = new Date().toISOString();
  if (posted.mode === "house") {
    await db
      .prepare(
        `INSERT INTO jobs (id, category, brief, offer_usd, authorization_id, status, mode, created_at, owner_session_id)
         VALUES (?, ?, ?, ?, ?, 'casting', 'house', ?, ?)`,
      )
      .bind(jobId, posted.category, posted.brief, posted.offer, `house_${jobId}`, at, ownerSessionId)
      .run();
    log("job_house", { jobId, category: posted.category, offer: posted.offer });
    return { jobId, status: "casting" };
  }
  if (!paypalReady(env)) throw new GameError("PayPal isn't configured in this room.", 400);
  const label = CATEGORIES.find((category) => category.id === posted.category)?.label ?? posted.category;
  const orderId = await createAuthorizationOrder(env, posted.offer, jobId, `Burn Rate ${label}: ${thing(posted.brief)}`);
  await db
    .prepare(
      `INSERT INTO jobs (id, category, brief, offer_usd, paypal_order_id, status, mode, created_at, owner_session_id)
       VALUES (?, ?, ?, ?, ?, 'draft', 'paypal', ?, ?)`,
    )
    .bind(jobId, posted.category, posted.brief, posted.offer, orderId, at, ownerSessionId)
    .run();
  log("job_paypal_order", { jobId, orderId, offer: posted.offer });
  return { jobId, orderId, status: "draft" };
}

export async function approveJob(env: AppEnv, jobId: string, orderId: string, sessionId: string): Promise<{ status: string; authorizationId: string }> {
  await assertOwner(env, jobId, sessionId);
  const db = env.DB;
  const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
  if (!job) throw new GameError("That job isn't on the board.", 404);
  if (job.status === "casting" || job.status === "judging" || job.status === "captured") {
    return { status: job.status, authorizationId: job.authorization_id ?? "" };
  }
  if (job.status !== "draft") throw new GameError("This authorization is already closed.", 409);
  if (!orderId || job.paypal_order_id !== orderId) throw new GameError("That PayPal order doesn't match this job.", 400);
  assertGenerationEnabled(env);
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

export async function pickWinner(env: AppEnv, jobId: string, entryId: string, sessionId: string): Promise<Resolution> {
  await assertOwner(env, jobId, sessionId);
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
  const showOffer = showWork && row.status === "ready";
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
    costDecision: books ? Math.round(row.cost_decision * 10000) / 10000 : 0,
    costGeneration: books ? Math.round(row.cost_generation * 10000) / 10000 : 0,
    bid: showOffer ? row.bid : null,
    pitch: showOffer ? row.pitch : null,
    deliverable: showOffer ? parseDeliverable(row.deliverable_json) : null,
  };
}

export async function jobView(env: AppEnv, jobId: string, sessionId: string | null = null) {
  const db = env.DB;
  const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
  if (!job) throw new GameError("That job isn't on the board.", 404);
  const phase = job.status === "captured" ? "books" : job.status === "judging" || job.status === "capturing" ? "gallery" : "working";
  const rows = await entriesFor(db, jobId);
  const agents = await db.prepare("SELECT * FROM agents").all<AgentRow>();
  const byId = new Map(agents.results.map((agent) => [agent.id, agent]));
  const entries = await Promise.all(rows.map((row) => publicEntry(row, byId.get(row.agent_id), phase)));
  const isOwner = Boolean(sessionId && job.owner_session_id === sessionId);
  return {
    job: {
      id: job.id,
      category: job.category,
      brief: job.brief,
      offer: cents(job.offer_usd),
      status: job.status === "capturing" ? "judging" : job.status,
      mode: job.mode,
      authorizationId: isOwner ? job.authorization_id : null,
      captureId: job.capture_id,
      createdAt: job.created_at,
      isOwner,
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

interface AgentJobRow {
  entry_id: string;
  job_id: string;
  entry_status: string;
  skip_reason: string | null;
  gen_label: string | null;
  cost_decision: number;
  cost_generation: number;
  bid: number | null;
  category: string;
  brief: string;
  offer_usd: number;
  job_status: string;
  winner_entry_id: string | null;
  captured_amount: number | null;
  created_at: string;
}

function agentJob(row: AgentJobRow) {
  const settled = row.job_status === "captured";
  const failed = row.job_status === "failed";
  const skipped = row.entry_status === "skipped";
  const won = settled && row.winner_entry_id === row.entry_id;
  const outcome = skipped ? "skipped" : won ? "won" : settled ? "lost" : failed ? "failed" : "open";
  const hidden = outcome === "open";
  const spent = cents(row.cost_decision + row.cost_generation);
  const paid = won ? cents(row.captured_amount ?? 0) : 0;
  return {
    jobId: row.job_id,
    category: row.category,
    brief: row.brief,
    offer: cents(row.offer_usd),
    createdAt: row.created_at,
    outcome,
    skipReason: skipped ? row.skip_reason : null,
    genLabel: hidden || skipped ? null : row.gen_label,
    bid: hidden || skipped || row.bid == null ? null : cents(row.bid),
    spent: hidden ? null : spent,
    paid,
    net: hidden ? null : cents(paid - spent),
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
  const flow = await db
    .prepare("SELECT ts, type, amount_usd FROM wallet_ledger WHERE agent_id = ? ORDER BY ts ASC, rowid ASC")
    .bind(id)
    .all<{ ts: string; type: string; amount_usd: number }>();
  let running = 0;
  const balanceHistory = flow.results.map((row) => ({ ts: row.ts, type: row.type, balance: cents((running += row.amount_usd)) }));
  const history = await db
    .prepare(
      `SELECT e.id AS entry_id, e.job_id, e.status AS entry_status, e.skip_reason, e.gen_label,
              e.cost_decision, e.cost_generation, e.bid,
              j.category, j.brief, j.offer_usd, j.status AS job_status, j.winner_entry_id, j.captured_amount, j.created_at
       FROM entries e JOIN jobs j ON j.id = e.job_id
       WHERE e.agent_id = ? AND j.status != 'draft'
       ORDER BY j.created_at DESC`,
    )
    .bind(id)
    .all<AgentJobRow>();
  const jobs = history.results.map(agentJob);
  const lanes = CATEGORIES.map((category) => {
    const mine = jobs.filter((job) => job.category === category.id);
    const decided = mine.filter((job) => job.outcome === "won" || job.outcome === "lost");
    const wins = decided.filter((job) => job.outcome === "won").length;
    const spent = cents(mine.reduce((sum, job) => sum + (job.spent ?? 0), 0));
    const earned = cents(mine.reduce((sum, job) => sum + job.paid, 0));
    return {
      id: category.id,
      label: category.label,
      seen: mine.length,
      entered: mine.filter((job) => job.outcome !== "skipped").length,
      decided: decided.length,
      wins,
      spent,
      earned,
      net: cents(earned - spent),
    };
  }).filter((lane) => lane.seen > 0);
  const decided = jobs.filter((job) => job.outcome === "won" || job.outcome === "lost");
  const winning = jobs.filter((job) => job.outcome === "won");
  const performance = {
    seen: jobs.length,
    entered: jobs.filter((job) => job.outcome !== "skipped").length,
    skipped: jobs.filter((job) => job.outcome === "skipped").length,
    decided: decided.length,
    wins: winning.length,
    winRate: decided.length ? winning.length / decided.length : null,
    avgWin: winning.length ? cents(winning.reduce((sum, job) => sum + job.paid, 0) / winning.length) : null,
    net: cents(stats.earnings - stats.spent),
    returnPerDollar: stats.spent > 0 ? stats.earnings / stats.spent : null,
  };
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
    performance,
    lanes,
    jobs: jobs.slice(0, 100),
    ledger: ledger.results.map((row) => ({ ...row, amount_usd: cents(row.amount_usd) })),
    balanceHistory,
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
  const agents = await db.prepare("SELECT * FROM agents ORDER BY born_at ASC").all<AgentRow>();
  const money = await db
    .prepare(
      `SELECT agent_id,
              SUM(amount_usd) AS balance,
              SUM(CASE WHEN type = 'win' THEN amount_usd ELSE 0 END) AS earned,
              SUM(CASE WHEN type IN ('decision_tokens', 'generation') THEN -amount_usd ELSE 0 END) AS spent,
              SUM(CASE WHEN type = 'decision_tokens' THEN -amount_usd ELSE 0 END) AS thinking
       FROM wallet_ledger GROUP BY agent_id`,
    )
    .all<{ agent_id: string; balance: number; earned: number; spent: number; thinking: number }>();
  const effort = await db
    .prepare(
      `SELECT e.agent_id,
              COUNT(*) AS seen,
              SUM(CASE WHEN e.status = 'ready' THEN 1 ELSE 0 END) AS entered,
              SUM(CASE WHEN e.status = 'ready' AND j.status = 'captured' THEN 1 ELSE 0 END) AS decided,
              SUM(CASE WHEN j.status = 'captured' AND j.winner_entry_id = e.id THEN 1 ELSE 0 END) AS wins
       FROM entries e JOIN jobs j ON j.id = e.job_id
       WHERE j.status != 'draft'
       GROUP BY e.agent_id`,
    )
    .all<{ agent_id: string; seen: number; entered: number; decided: number; wins: number }>();
  const moneyById = new Map(money.results.map((row) => [row.agent_id, row]));
  const effortById = new Map(effort.results.map((row) => [row.agent_id, row]));
  const board = agents.results.map((agent) => {
    const cash = moneyById.get(agent.id);
    const work = effortById.get(agent.id);
    const earned = cents(cash?.earned ?? 0);
    const spent = cents(cash?.spent ?? 0);
    const decided = work?.decided ?? 0;
    const wins = work?.wins ?? 0;
    return {
      id: agent.id,
      name: agent.name,
      model: agent.base_model,
      voice: agent.voice,
      status: agent.status,
      balance: cents(cash?.balance ?? 0),
      seen: work?.seen ?? 0,
      entered: work?.entered ?? 0,
      decided,
      wins,
      winRate: decided ? wins / decided : null,
      earned,
      spent,
      thinking: cents(cash?.thinking ?? 0),
      net: cents(earned - spent),
      returnPerDollar: spent > 0 ? earned / spent : null,
    };
  });

  const jobs = await db
    .prepare("SELECT * FROM jobs WHERE status != 'draft' ORDER BY created_at DESC LIMIT 100")
    .all<JobRow>();
  const burnRows = await db
    .prepare(
      `SELECT ref, SUM(-amount_usd) AS burned FROM wallet_ledger
       WHERE type IN ('decision_tokens', 'generation') GROUP BY ref`,
    )
    .all<{ ref: string; burned: number }>();
  const entrantRows = await db
    .prepare(
      `SELECT job_id, SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS entered, COUNT(*) AS seen
       FROM entries GROUP BY job_id`,
    )
    .all<{ job_id: string; entered: number; seen: number }>();
  const burnByJob = new Map(burnRows.results.map((row) => [row.ref, row.burned]));
  const entrantsByJob = new Map(entrantRows.results.map((row) => [row.job_id, row]));
  const jobList = jobs.results.map((job) => {
    const resolution = job.resolution_json ? (JSON.parse(job.resolution_json) as Resolution) : null;
    const status = job.status === "capturing" ? "judging" : job.status;
    const counts = entrantsByJob.get(job.id);
    return {
      id: job.id,
      category: job.category,
      brief: job.brief,
      createdAt: job.created_at,
      status,
      mode: job.mode,
      offer: cents(job.offer_usd),
      paid: status === "captured" ? cents(job.captured_amount ?? 0) : null,
      burned: cents(burnByJob.get(job.id) ?? 0),
      entered: counts?.entered ?? 0,
      seen: counts?.seen ?? 0,
      winnerId: status === "captured" ? (resolution?.winnerId ?? null) : null,
      winnerName: status === "captured" ? (resolution?.winnerName ?? null) : null,
      winnerModel: status === "captured" ? (resolution?.winnerModel ?? null) : null,
    };
  });

  const rows = await db
    .prepare(
      `SELECT l.id, l.ts, l.type, l.amount_usd, l.ref, l.note, l.agent_id, a.name AS agent_name, a.base_model, j.id AS job_id
       FROM wallet_ledger l
       JOIN agents a ON a.id = l.agent_id
       LEFT JOIN jobs j ON j.id = l.ref
       ORDER BY l.ts DESC LIMIT 200`,
    )
    .all<{
      id: string;
      ts: string;
      type: string;
      amount_usd: number;
      ref: string | null;
      note: string | null;
      agent_id: string;
      agent_name: string;
      base_model: string;
      job_id: string | null;
    }>();

  const settled = jobList.filter((job) => job.status === "captured");
  return {
    totals: {
      jobs: jobList.length,
      settled: settled.length,
      held: cents(settled.reduce((sum, job) => sum + job.offer, 0)),
      paid: cents(settled.reduce((sum, job) => sum + (job.paid ?? 0), 0)),
      burned: cents(board.reduce((sum, agent) => sum + agent.spent, 0)),
      alive: board.filter((agent) => agent.status === "alive").length,
      dead: board.filter((agent) => agent.status === "dead").length,
    },
    agents: board,
    jobs: jobList,
    rows: rows.results.map((row) => ({ ...row, amount_usd: cents(row.amount_usd) })),
  };
}

export function configView(env: AppEnv) {
  const readyPaypal = paypalReady(env);
  return {
    paypal: readyPaypal,
    paypalClientId: readyPaypal ? env.PAYPAL_CLIENT_ID : null,
    paypalMode: paypalMode(env),
    offerMin: 0.5,
    offerMax: 5,
    categories: CATEGORIES,
    accessRequired: true,
    signInEnabled: emailConfigured(env),
    generationEnabled: generationEnabled(env),
    generationLimits: generationLimits(env),
  };
}
