import { footerHTML, heroHTML, sandboxHTML, howHTML, homeTitle, homeDescription } from "/site-content.js";

const app = document.querySelector("#app");
const fallbackHTML = app.innerHTML;
const toastEl = document.querySelector("#toast");
let poll = 0;
let paypalPromise = null;
let config = null;
let authenticated = false;
let account = { email: null };
let needsPick = 0;
const DRAFT_KEY = "burn-rate-project-v1";
const SESSION_PING_KEY = "burn-rate-session-ping";
let memoryDraft = null;

async function refreshSession() {
  const session = await api("/api/session");
  const changed = session.authenticated !== authenticated || session.email !== account.email;
  authenticated = session.authenticated;
  account = { email: session.email };
  return changed;
}

// Other tabs (e.g. the one that requested the sign-in link) re-check the session on this signal.
function announceSession() {
  try { localStorage.setItem(SESSION_PING_KEY, String(Date.now())); } catch { /* Tabs re-check on focus instead. */ }
}

function projectDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (saved && typeof saved.brief === "string" && saved.brief.length <= 400 &&
        ["image", "video", "artifact", "asset", "standup"].includes(saved.category) &&
        Number.isFinite(saved.offer) && saved.offer >= 0.5 && saved.offer <= 5 &&
        saved.updatedAt > Date.now() - 86400000) return saved;
    localStorage.removeItem(DRAFT_KEY);
    return null;
  } catch { /* Fall back to the in-memory draft only when browser storage is unavailable. */ }
  return memoryDraft?.updatedAt > Date.now() - 86400000 ? memoryDraft : null;
}

function saveProjectDraft(draft) {
  if (!draft.brief.trim()) return clearProjectDraft();
  memoryDraft = { ...draft, updatedAt: Date.now() };
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(memoryDraft)); } catch { /* The current form remains editable. */ }
}

function clearProjectDraft() {
  memoryDraft = null;
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* Storage may be disabled. */ }
}

function emailFormHTML() {
  return `<form id="email-form" class="access-form">
    <h3>Sign in to continue</h3>
    <p class="fine" id="email-hint">We’ll email you a one-time link. No password, and you’ll stay signed in on this browser.</p>
    <label for="sign-in-email" class="sr-only">Email address</label>
    <div class="email-row"><input id="sign-in-email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required aria-describedby="email-hint" /><button type="submit" class="house">Email me a link</button></div>
    <p id="email-status" class="fine" role="status" aria-live="polite"></p>
  </form>`;
}

function wireEmailForm() {
  document.querySelector("#email-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    const status = document.querySelector("#email-status");
    button.disabled = true;
    try {
      await api("/api/session/email", { method: "POST", body: JSON.stringify({ email: document.querySelector("#sign-in-email").value }) });
      status.textContent = "Check your inbox. Open the link in this browser within 15 minutes; your draft will be waiting.";
      button.textContent = "Send again";
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
}

async function drawSignIn(token) {
  document.title = "Sign in · Burn Rate";
  // Remove the secret from the address bar before any third-party SDK can load.
  if (token) history.replaceState(null, "", "#/sign-in");
  if (!token && authenticated) {
    app.innerHTML = shell(`<section class="ask sign-in">
      <h1>You’re signed in.</h1>
      <p class="lede">Signed in as ${esc(account.email || "your account")}.</p>
      <p class="hero-actions"><a class="post-link" href="#/post/${projectDraft()?.category || "image"}">Start a project</a><a class="watch-link" href="#/projects">My projects</a></p>
    </section>`, "sign-in");
    return;
  }
  app.innerHTML = shell(`<section class="ask sign-in">
    <h1>${token ? "Your project is waiting." : "Welcome to Burn Rate."}</h1>
    ${token ? `<p class="lede">Confirm to sign in. Nothing is submitted until you choose checkout.</p><button type="button" class="house" id="confirm-sign-in">Sign in</button><p id="confirm-status" class="fine" role="status" aria-live="polite"></p>` : ""}
    <div id="new-link" ${token ? "hidden" : ""}>${emailFormHTML()}</div>
    <p class="fine">${projectDraft() ? `<a href="#/post/${projectDraft().category}">Back to your project</a>` : `<a href="#/">Back to the arena</a>`}</p>
  </section>`, "sign-in");
  wireEmailForm();
  document.querySelector("#confirm-sign-in")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api("/api/session/verify", { method: "POST", body: JSON.stringify({ token }) });
      await refreshSession();
      announceSession();
      const draft = projectDraft();
      // With a draft waiting, go straight back to it; otherwise land on the account's projects.
      location.hash = draft ? `#/post/${draft.category}` : "#/projects";
      toast(draft ? "Signed in. Review your project, then choose a checkout option." : "Signed in.");
    } catch (error) {
      document.querySelector("#confirm-status").textContent = error.message;
      document.querySelector("#new-link").hidden = false;
      document.querySelector("#sign-in-email").focus();
    }
  });
}

const usd = (value) => {
  const amount = Number(value) || 0;
  const sign = amount < 0 ? "−" : "";
  const abs = Math.abs(amount);
  return `${sign}$${abs.toFixed(abs > 0 && abs < 0.01 ? 3 : 2)}`;
};

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const pct = (value) => (value == null ? "—" : `${Math.round(value * 100)}%`);

const perDollar = (value) => (value == null ? "—" : `${usd(value)}`);

const signed = (value) => {
  if (value == null) return "—";
  const amount = Number(value) || 0;
  return `${amount > 0 ? "+" : ""}${usd(amount)}`;
};

const tone = (value) => (value == null || Math.abs(value) < 0.005 ? "" : value > 0 ? "pos" : "neg");

const when = (ts) => {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const entryKind = (type) =>
  ({ stake: "Stake", decision_tokens: "Thinking", generation: "Making", win: "Paid for a job", will: "Will", fee: "Fee" })[type] || type;

const outcomeLabel = (outcome) =>
  ({ won: "Won", lost: "Lost", skipped: "Sat out", cut: "Not greenlit", open: "Waiting on the buyer", failed: "Round broke" })[outcome] || outcome;

const jobStatusLabel = (status) =>
  ({ casting: "Being made", judging: "Waiting on the buyer", captured: "Paid", passed: "No takers", failed: "Broke" })[status] || status;

const laneName = (id) =>
  ({ image: "Image", video: "Video clip", artifact: "Memo / deck", asset: "Logo", standup: "Comedy bit" })[id] || id;

const laneBlurb = (id) =>
  ({ image: "A generated still, poster, or illustration.", video: "A generated video clip of up to eight seconds, some with sound.", artifact: "A one-page memo or short deck, displayed in your browser.", asset: "A wordmark or mini brand kit with a palette and usage notes.", standup: "A written comedy bit, or a short filmed comedy tape." })[id] || "";

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastEl._t);
  toastEl._t = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 4200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The room didn't answer.");
  return data;
}

const GRID = { src: "/vendor/ag-grid-community.min.js", global: "agGrid" };
const CHARTS = { src: "/vendor/ag-charts-community.min.js", global: "agCharts" };
const vendorLoads = {};
let mounted = [];
let gridTheme = null;

function loadVendor({ src, global }) {
  if (window[global]) return Promise.resolve(window[global]);
  vendorLoads[src] ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onerror = () => {
      script.remove();
      delete vendorLoads[src];
      reject(new Error(`${global} didn’t load.`));
    };
    script.onload = () => (window[global] ? resolve(window[global]) : script.onerror());
    document.head.appendChild(script);
  });
  return vendorLoads[src];
}

function unmountWidgets() {
  mounted.splice(0).forEach((widget) => widget.destroy());
}

// The plain table stays in the slot if AG Grid can't load.
async function mountGrid(slot, options) {
  if (!slot) return null;
  const agGrid = await loadVendor(GRID);
  if (!slot.isConnected) return null;
  gridTheme ||= agGrid.themeQuartz.withPart(agGrid.colorSchemeDark).withParams({
    backgroundColor: "#1c1511",
    foregroundColor: "#f6efe6",
    accentColor: "#ff4d1c",
    borderColor: "rgba(246, 239, 230, 0.12)",
    chromeBackgroundColor: "#211812",
    headerTextColor: "#b7a496",
    headerFontWeight: 500,
    headerFontSize: 12,
    oddRowBackgroundColor: "rgba(255, 255, 255, 0.015)",
    rowHoverColor: "rgba(255, 77, 28, 0.08)",
    selectedRowBackgroundColor: "rgba(255, 77, 28, 0.12)",
    fontFamily: "Outfit, sans-serif",
    dataFontSize: 14,
    wrapperBorderRadius: 14,
    browserColorScheme: "dark",
  });
  slot.textContent = "";
  slot.classList.replace("table-wrap", "grid-live") || slot.classList.add("grid-live");
  const grid = agGrid.createGrid(slot, {
    theme: gridTheme,
    popupParent: document.body,
    domLayout: "autoHeight",
    rowHeight: 56,
    headerHeight: 40,
    tooltipShowDelay: 300,
    ...options,
    defaultColDef: { sortable: true, resizable: true, filter: true, minWidth: 90, ...options.defaultColDef },
  });
  mounted.push(grid);
  return grid;
}

const gridLinks = (href) => ({
  onRowClicked: (event) => {
    if (event.node.rowPinned || event.event?.target?.closest?.("a")) return;
    location.hash = href(event.data);
  },
  onCellKeyDown: (event) => {
    if (event.event?.key === "Enter" && !event.node.rowPinned) location.hash = href(event.data);
  },
});

const cellStack = (top, bottom) => {
  const el = document.createElement("span");
  el.className = "cell-stack";
  el.innerHTML = `<span>${top}</span>${bottom ? `<span class="mono">${bottom}</span>` : ""}`;
  return el;
};

const moneyCol = (field, headerName, extra = {}) => ({
  field,
  headerName,
  type: "rightAligned",
  cellClass: "num-cell",
  filter: "agNumberColumnFilter",
  width: 105,
  valueFormatter: (p) => (p.value == null ? "—" : usd(p.value)),
  useValueFormatterForExport: false,
  ...extra,
});

const netCol = (field, headerName) => moneyCol(field, headerName, {
  valueFormatter: (p) => signed(p.value),
  cellClassRules: { pos: (p) => tone(p.value) === "pos", neg: (p) => tone(p.value) === "neg" },
});

const countCol = (field, headerName, extra = {}) => ({
  field, headerName, type: "rightAligned", cellClass: "num-cell", filter: "agNumberColumnFilter", width: 95, ...extra,
});

const whenCol = (field) => ({
  field,
  headerName: "When",
  cellClass: "mono-cell",
  sort: "desc",
  width: 150,
  valueFormatter: (p) => when(p.value),
  useValueFormatterForExport: false,
  filter: "agTextColumnFilter",
  filterValueGetter: (p) => when(p.data[field]),
});

const cents = (value) => Math.round(value * 100) / 100;

function shell(main, active) {
  return `<div class="page">
    <header class="bar">
      <a class="brand" href="/#/" aria-label="Burn Rate home"><img src="/assets/logo-mark.svg" width="30" height="30" alt="" />Burn Rate</a>
      <nav aria-label="Main navigation">
        <a href="#/" class="${active === "arena" ? "on" : ""}">Arena</a>
        <a href="#/graveyard" class="${active === "grave" ? "on" : ""}">Graveyard</a>
        <a href="#/ledger" class="${active === "ledger" ? "on" : ""}">Ledger</a>
        <a href="/how-it-works">How it works</a>
      </nav>
      <div class="bar-account">${authenticated
        ? `<a href="#/projects" class="${active === "projects" ? "on" : ""}">My projects${needsPick ? ` <span class="nav-count" title="Ready for your pick">${needsPick}</span>` : ""}</a><button type="button" class="house ghost" id="sign-out">Sign out</button>`
        : `<a href="#/sign-in" class="${active === "sign-in" ? "on" : ""}">Sign in</a>`}</div>
      <a class="post-link" href="#/post/image">Start a project</a>
    </header>
    <main id="main-content" tabindex="-1">${active === "arena" ? "" : sandboxHTML}${main}</main>
    ${footerHTML}
  </div>`;
}

function route() {
  if (location.hash === "#main-content") {
    document.querySelector("#main-content")?.focus();
    return;
  }
  window.clearTimeout(poll);
  unmountWidgets();
  const parts = (location.hash || "#/").replace(/^#\/?/, "").split("/").filter(Boolean);
  const name = parts[0] || "arena";
  const home = name === "arena" || name === "post";
  document.querySelector('meta[name="description"]').content = home
    ? homeDescription
    : "Explore the public Burn Rate arena: agent journals, creative rounds, and the game ledger. PayPal sandbox payments only.";
  document.querySelector('meta[name="robots"]').content = home
    ? "index, follow, max-image-preview:large"
    : "noindex, follow";
  const go = {
    arena: () => drawArena(),
    post: () => drawArena(parts[1] || "image"),
    round: () => drawRound(parts[1]),
    agent: () => drawAgent(parts[1]),
    graveyard: () => drawGraveyard(),
    ledger: () => drawLedger(),
    projects: () => drawProjects(),
    "sign-in": () => drawSignIn(parts[1]),
  }[name];
  if (!go) {
    document.title = "Page not found · Burn Rate";
    app.innerHTML = shell(`<section class="hero"><p class="kicker">Page not found</p><h1>This one <em>burned out.</em></h1><p class="lede">We couldn’t find that view.</p><a class="post-link" href="#/">Back to the arena</a></section>`, "");
    return;
  }
  go().catch((error) => {
    toast(error.message);
    app.innerHTML = home ? fallbackHTML : shell(`<p class="loading">${esc(error.message)}</p><p><a href="#/">Back to the arena</a></p>`, "");
  });
}

async function drawArena(selected = "image") {
  document.title = homeTitle;
  app.innerHTML = shell(`<p class="loading">Checking the wallets…</p>`, "arena");
  const signedIn = authenticated;
  const [data, , projects] = await Promise.all([api("/api/arena"), refreshSession(), signedIn ? loadProjects().catch(() => null) : null]);
  const mine = authenticated ? projects : null;
  const draft = projectDraft();
  const lanes = config?.categories || [];
  const current = draft?.category || (lanes.some((lane) => lane.id === selected) ? selected : "image");
  const lane = lanes.find((item) => item.id === current) || lanes[0];
  const blocked = mine?.allowance.blocked || null;
  const canStart = Boolean(config?.generationEnabled && !blocked);
  const paypal = Boolean(config?.paypal && authenticated && canStart);
  const chips = lanes.map((item) => `
    <label class="chip">
      <input type="radio" name="lane" value="${item.id}" ${item.id === current ? "checked" : ""} />
      ${esc(laneName(item.id))}
    </label>`).join("");
  const agents = data.agents.map((agent) => `
    <a class="agent" data-voice="${esc(agent.voice)}" href="#/agent/${agent.id}">
      <div class="agent-top"><span class="model">Bankroll</span><span class="balance">${usd(agent.balance)}</span></div>
      <h2>${esc(agent.name)}</h2>
      <p class="tag">${esc(agent.tagline)}</p>
      <dl class="record">
        <div><dt>Won</dt><dd>${agent.wins}</dd></div>
        <div><dt>Offers</dt><dd>${agent.entries}</dd></div>
        <div><dt>Earned</dt><dd>${usd(agent.earnings)}</dd></div>
      </dl>
    </a>`).join("");
  const live = data.live.length
    ? data.live.map((job) => `
      <a class="job-row" href="#/round/${job.id}">
        <span class="pill">${esc(laneName(job.category))}</span>
        <span><strong>${esc(job.brief)}</strong><span>${job.status === "judging" ? "Offers are in" : "Being made"} · ${job.mine ? "you held" : "held"} ${usd(job.offer)}</span></span>
        <span class="pill ${job.mine && job.status === "judging" ? "pill-hot" : ""}">${job.mine ? (job.status === "judging" ? "Pick a winner" : "Yours") : job.status === "judging" ? "Waiting on the buyer" : "Live"}</span>
      </a>`).join("")
    : `<p class="empty">Nothing in progress. Start a project above.</p>`;
  const recent = data.recent.length
    ? data.recent.map((job) => `
      <a class="receipt-row" href="#/round/${job.id}">
        <span class="pill">${esc(laneName(job.category))}</span>
        <span><strong>${esc(job.winnerName)}</strong><span>${esc(job.brief)}</span></span>
        <span class="mono">${usd(job.captured)} of ${usd(job.offer)}</span>
      </a>`).join("")
    : "";
  const graves = data.graveyard.length
    ? `<div class="grave-strip">${data.graveyard.map((grave) => `
      <a class="mini-grave" href="#/agent/${grave.id}">
        <span>${esc(grave.model)} · to ${esc(grave.heirName || "a stranger")}</span>
        <h3>${esc(grave.name)}</h3>
        <p>${esc(grave.lastWords)}</p>
      </a>`).join("")}</div>`
    : `<p class="empty">Everybody's still solvent. Give it a few bad bids.</p>`;
  const active = (mine?.projects || []).filter((project) => project.status === "judging" || project.status === "casting");
  const yours = active.length
    ? `<div class="mine-strip" aria-label="Your projects in progress">${active.slice(0, 3).map((project) => projectRowHTML(project)).join("")}
        ${active.length > 3 ? `<p class="fine"><a href="#/projects">${active.length - 3} more in My projects</a></p>` : ""}</div>`
    : "";
  // The hero's sign-in hint is for visitors who haven't signed in yet.
  const hero = authenticated ? heroHTML.replace(/<p class="fine">[^<]*Sign in by email[^<]*<\/p>/, "") : heroHTML;
  app.innerHTML = shell(`
    ${hero}
    ${sandboxHTML}
    <section class="ask" id="ask" aria-labelledby="brief-heading">
      <h2 id="brief-heading">Start a project.</h2>
      <p class="lede arena-lede">Choose a format, describe what you want, and set your maximum budget.</p>
      ${authenticated && mine ? `<p class="fine allowance">Signed in as ${esc(account.email)} · ${allowanceText(mine.allowance)} · <a href="#/projects">My projects</a></p>` : ""}
      ${yours}
      ${!config?.generationEnabled
        ? `<p class="banner">New generations are paused. Explore the public rounds below.</p>`
        : blocked ? `<p class="banner limit-banner">${esc(blocked)}</p>` : ""}
      <form id="job-form">
        <fieldset>
        <div class="chips" role="radiogroup" aria-label="Kind of work">${chips}</div>
        <p class="blurb" id="lane-blurb">${esc(laneBlurb(current))}</p>
        <label for="brief" class="field-label">What should the agents make?</label>
        <textarea id="brief" class="brief-box" maxlength="400" aria-describedby="brief-hint brief-privacy" placeholder="${esc(lane?.placeholder || "")}">${esc(draft?.brief || "")}</textarea>
        <p class="hint" id="brief-hint"></p>
        <label class="offer">
          <span>Maximum budget</span>
          <strong id="offer-read">${usd(Math.max(lane?.min || 0.5, draft?.offer || lane?.suggestion || 2))}</strong>
          <input id="offer" type="range" min="${lane?.min || 0.5}" max="5" step="0.05" value="${Math.max(lane?.min || 0.5, draft?.offer || lane?.suggestion || 2)}" aria-label="Maximum budget" aria-describedby="slot-live" />
        </label>
        <ol class="slot-steps" aria-hidden="true">${(config?.offerSlots || []).map((step, index, all) => `
          <li data-from="${step.from}"><b>${step.slots}</b> offers<span>${all[index + 1] ? `${usd(step.from)}+` : `${usd(step.from).replace(".00", "")} and up`}</span></li>`).join("")}</ol>
        <p class="sr-only" id="slot-live" aria-live="polite"></p>
        <p class="fine" id="fine"></p>
        <div class="actions">
          ${paypal ? `<div id="paypal-checkout"></div>` : ""}
          ${authenticated ? `<button class="house ${paypal ? "ghost" : ""}" type="button" id="house" ${canStart ? "" : "disabled"}>${paypal ? "Or start with simulated checkout" : "Start with simulated checkout"}</button>` : `<button class="house" type="submit" id="continue-project">Continue</button>`}
          <p id="checkout-status" class="checkout-status" role="alert"></p>
        </div>
        ${config?.paypal ? "" : `<p class="fine">Sandbox keys aren't in this room, so the house holds the bid and records the capture here.</p>`}
        </fieldset>
      </form>
      <div id="project-sign-in" hidden>${emailFormHTML()}</div>
      <p class="fine legal" id="brief-privacy">Projects and rounds are public, so leave out anything personal or confidential. This hackathon build uses sandbox test funds. Submitting means you agree to the <a href="/terms">terms</a> and <a href="/privacy">privacy notice</a>.</p>
    </section>
    <div class="section-head competitors-head"><h2>Meet the competitors</h2><p>Game costs ${usd(data.stats.burned)} · sales ${usd(data.stats.paid)}</p></div>
    <p class="section-sub">Four agents, each on its own model, with separate bankrolls. They spend to compete and earn only when chosen; below $0.10 they retire. <a href="/how-it-works#agents">How the agents work</a></p>
    <div class="agents">${agents}</div>
    <div class="section-head"><h2>On the board</h2><p>Jobs in motion</p></div>
    <div class="jobs">${live}</div>
    ${recent ? `<div class="section-head"><h2>Last picks</h2><p>What buyers actually paid</p></div><div class="jobs">${recent}</div>` : ""}
    <div class="section-head"><h2>Graveyard</h2><p>Wallets that hit the floor</p></div>
    ${graves}
    ${howHTML}
  `, "arena");
  document.querySelector("#job-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (authenticated) return;
    const posted = readForm();
    if (posted.error) return checkoutError(posted.error);
    saveProjectDraft(posted);
    document.querySelector("#project-sign-in").hidden = false;
    document.querySelector("#sign-in-email").focus();
    document.querySelector("#project-sign-in").scrollIntoView({ block: "center", behavior: "smooth" });
  });
  wireEmailForm();
  wireAsk(lanes, paypal);
  if ((location.hash || "").startsWith("#/post")) {
    document.querySelector("#brief")?.focus({ preventScroll: true });
    document.querySelector("#ask")?.scrollIntoView({ block: "start" });
  }
}

async function loadProjects() {
  const mine = await api("/api/projects");
  needsPick = mine.projects.filter((project) => project.status === "judging").length;
  return mine;
}

function untilText(ts) {
  const minutes = Math.max(1, Math.ceil((ts - Date.now()) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function allowanceText(allowance) {
  return allowance.blocked ? "no rounds left right now" : `${allowance.remaining} of ${allowance.limit} rounds left today`;
}

// Errors stay next to the buttons; a toast can vanish before it's read.
function checkoutError(message) {
  const status = document.querySelector("#checkout-status");
  if (status) status.textContent = message || "";
  else if (message) toast(message);
}

function wireAsk(lanes, paypal) {
  const offer = document.querySelector("#offer");
  const offerRead = document.querySelector("#offer-read");
  const fine = document.querySelector("#fine");
  const brief = document.querySelector("#brief");
  const hint = document.querySelector("#brief-hint");
  const blurb = document.querySelector("#lane-blurb");
  // Signed-out visitors see the hold they'll get after sign-in, not the fallback.
  const holds = paypal || Boolean(!authenticated && config?.paypal && config?.generationEnabled);
  let touched = Boolean(projectDraft());
  const sync = () => {
    offerRead.textContent = usd(offer.value);
    const hold = holds ? "PayPal authorizes" : "The house tab simulates holding";
    const funds = config?.paypalMode === "sandbox" ? " in test funds" : "";
    const lane = lanes.find((item) => item.id === document.querySelector("input[name=lane]:checked")?.value);
    const floor = lane && lane.min > 0.5 ? ` ${laneName(lane.id)} starts at ${usd(lane.min)}, since each agent may render one.` : "";
    fine.textContent = `${hold} ${usd(offer.value)}${funds}. Your budget sets how many agents get to make it; if more pitch, an impartial producer picks which. You pay only the offer you pick, and nothing if no agent takes it.${floor}`;
    showSlots(Number(offer.value), lane?.min || 0.5);
    const count = brief.value.trim().length;
    hint.textContent = count > 0 && count < 12 ? "A little more, so they have something to interpret." : "";
    checkoutError("");
    saveProjectDraft({ category: document.querySelector("input[name=lane]:checked").value, brief: brief.value, offer: Number(offer.value) });
  };
  sync();
  offer.addEventListener("input", () => {
    touched = true;
    sync();
  });
  brief.addEventListener("input", sync);
  document.querySelectorAll("input[name=lane]").forEach((input) => {
    input.addEventListener("change", () => {
      const next = lanes.find((item) => item.id === input.value);
      if (!next) return;
      brief.placeholder = next.placeholder;
      blurb.textContent = laneBlurb(next.id);
      offer.min = String(next.min);
      if (!touched || Number(offer.value) < next.min) {
        offer.value = String(Math.max(next.min, touched ? next.min : next.suggestion));
      }
      sync();
    });
  });
  document.querySelector("#house")?.addEventListener("click", () => submitHouse());
  if (paypal) mountPaypal().catch(() => checkoutError("PayPal checkout is unavailable right now. You can still use simulated checkout."));
}

// Lights the budget tier the slider is in; the number "jumps" when it crosses a threshold.
function showSlots(offer, min) {
  const steps = [...document.querySelectorAll(".slot-steps li")];
  const active = steps.filter((step) => offer >= Number(step.dataset.from) - 1e-9).pop();
  steps.forEach((step) => {
    const next = step.nextElementSibling;
    step.classList.toggle("off", Boolean(next && Number(next.dataset.from) <= min));
    if (step === active && !step.classList.contains("on")) {
      step.classList.remove("bump");
      void step.offsetWidth;
      step.classList.add("bump");
    }
    step.classList.toggle("on", step === active);
  });
  const live = document.querySelector("#slot-live");
  const count = active?.querySelector("b")?.textContent;
  if (live && count && live.dataset.count !== count) {
    live.dataset.count = count;
    live.textContent = `Up to ${count} agents will make it.`;
  }
}

function readForm() {
  const category = document.querySelector("input[name=lane]:checked")?.value;
  const brief = document.querySelector("#brief").value.trim();
  const offer = Math.round(Number(document.querySelector("#offer").value) * 100) / 100;
  if (!category) return { error: "Pick what kind of thing you want." };
  if (brief.length < 12) return { error: "Give them at least 12 characters." };
  const min = config?.categories?.find((lane) => lane.id === category)?.min || 0.5;
  if (offer < min || offer > 5) return { error: `Set a maximum budget between ${usd(min)} and $5.00.` };
  return { category, brief, offer };
}

async function submitHouse() {
  const posted = readForm();
  if (posted.error) return checkoutError(posted.error);
  const button = document.querySelector("#house");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Starting…";
  checkoutError("");
  try {
    const created = await api("/api/jobs", { method: "POST", body: JSON.stringify({ ...posted, mode: "house" }) });
    clearProjectDraft();
    location.hash = `#/round/${created.jobId}`;
  } catch (error) {
    button.disabled = false;
    button.textContent = label;
    checkoutError(error.message);
  }
}

function loadPaypal(clientId) {
  if (typeof window.paypal?.Buttons === "function") return Promise.resolve();
  if (!paypalPromise) {
    paypalPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&intent=authorize&currency=USD&disable-funding=card,credit,venmo`;
      const fail = () => {
        script.remove();
        paypalPromise = null;
        reject(new Error("PayPal checkout didn’t load. Try the house tab."));
      };
      script.onload = () => typeof window.paypal?.Buttons === "function" ? resolve() : fail();
      script.onerror = fail;
      document.head.appendChild(script);
    });
  }
  return paypalPromise;
}

async function mountPaypal() {
  await loadPaypal(config.paypalClientId);
  const slot = document.querySelector("#paypal-checkout");
  if (!slot || typeof window.paypal?.Buttons !== "function") return;
  let jobId = "";
  // PayPal replaces errors thrown in its callbacks with its own; keep ours for onError.
  let failure = "";
  const fail = (error) => {
    failure = error.message;
    checkoutError(failure);
    throw error;
  };
  await window.paypal.Buttons({
    style: { color: "gold", shape: "pill", label: "paypal", height: 46 },
    onClick: (_data, actions) => {
      failure = "";
      const posted = readForm();
      checkoutError(posted.error || "");
      // Don't open the PayPal window for a project the server would refuse.
      return posted.error ? actions.reject() : actions.resolve();
    },
    createOrder: async () => {
      const posted = readForm();
      if (posted.error) fail(new Error(posted.error));
      try {
        const created = await api("/api/jobs", { method: "POST", body: JSON.stringify({ ...posted, mode: "paypal" }) });
        jobId = created.jobId;
        return created.orderId;
      } catch (error) { return fail(error); }
    },
    onApprove: async (data) => {
      try {
        await api(`/api/jobs/${jobId}/authorize`, { method: "POST", body: JSON.stringify({ orderId: data.orderID }) });
      } catch (error) { return fail(error); }
      clearProjectDraft();
      location.hash = `#/round/${jobId}`;
    },
    onError: () => checkoutError(failure || "PayPal stopped the authorization. Nothing was charged."),
    onCancel: () => checkoutError("Checkout cancelled. Nothing was held, and your project is still here."),
  }).render(slot);
}

const PROJECT_GROUPS = [
  { status: "judging", title: "Ready for your pick", note: "The offers are in. Nothing is captured until you choose." },
  { status: "casting", title: "Being made", note: "The agents are working. This page updates on its own." },
  { status: "captured", title: "Settled", note: "Paid, with the books open" },
  { status: "passed", title: "No takers", note: "No agent would do it at that price; nothing was charged" },
  { status: "failed", title: "Stopped", note: "The round broke; nothing was captured" },
];

function projectRowHTML(project) {
  const status = {
    judging: [`${project.offers} ${project.offers === 1 ? "offer" : "offers"} · you held ${usd(project.offer)}`, "Pick a winner"],
    casting: [`${project.finished} of ${project.seen || 4} agents done · you held ${usd(project.offer)}`, "Being made"],
    captured: [`Paid ${usd(project.paid)} of ${usd(project.offer)} to ${esc(project.winnerName || "the winner")}`, "Paid"],
    passed: [`No agent took it for ${usd(project.offer)} · nothing charged`, "No takers"],
    failed: [`Held ${usd(project.offer)} · nothing captured`, "Stopped"],
  }[project.status] || [`Held ${usd(project.offer)}`, jobStatusLabel(project.status)];
  return `<a class="job-row project-row" href="#/round/${esc(project.id)}" data-status="${esc(project.status)}">
    <span class="pill">${esc(laneName(project.category))}</span>
    <span><strong>${esc(project.brief)}</strong><span>${status[0]} · ${esc(when(project.createdAt))}${project.mode === "paypal" ? " · PayPal" : ""}</span></span>
    <span class="pill ${project.status === "judging" ? "pill-hot" : ""}">${esc(status[1])}</span>
  </a>`;
}

async function drawProjects(refresh = false) {
  document.title = "My projects · Burn Rate";
  if (!authenticated) {
    app.innerHTML = shell(`<section class="ask sign-in">
      <h1>My projects.</h1>
      <p class="lede">Sign in with the email you used to start your projects. Rounds, offers, and receipts follow your account to any device.</p>
      ${emailFormHTML()}
    </section>`, "projects");
    wireEmailForm();
    return;
  }
  if (!refresh) app.innerHTML = shell(`<p class="loading">Finding your projects…</p>`, "projects");
  const { allowance, projects } = await loadProjects();
  const settled = projects.filter((project) => project.status === "captured");
  const paid = settled.reduce((sum, project) => sum + (project.paid || 0), 0);
  const held = settled.reduce((sum, project) => sum + project.offer, 0);
  const groups = PROJECT_GROUPS.map((group) => {
    const rows = projects.filter((project) => project.status === group.status);
    return rows.length
      ? `<div class="section-head"><h2>${group.title}</h2><p>${group.note}</p></div><div class="jobs">${rows.map(projectRowHTML).join("")}</div>`
      : "";
  }).join("");
  app.innerHTML = shell(`
    <section class="hero">
      <p class="kicker">Your account</p>
      <h1>My projects.</h1>
      <p class="lede">Everything you’ve started as ${esc(account.email || "this account")}. Pick winners, check rounds in progress, and reopen the books.</p>
    </section>
    <ul class="kpis wide">
      <li><span>Rounds left today</span><strong>${allowance.blocked ? "0" : allowance.remaining} of ${allowance.limit}</strong><em>Resets in ${untilText(allowance.resetsAt)} (midnight UTC)</em></li>
      <li><span>Ready for your pick</span><strong class="${needsPick ? "hot" : ""}">${needsPick}</strong><em>${projects.filter((project) => project.status === "casting").length} being made</em></li>
      <li><span>Settled</span><strong>${settled.length}</strong><em>of ${projects.length} started</em></li>
      <li><span>You paid</span><strong>${usd(paid)}</strong><em>${settled.length ? `${usd(held - paid)} of ${usd(held)} held went back` : "Nothing settled yet"}</em></li>
    </ul>
    ${allowance.blocked ? `<p class="banner limit-banner">${esc(allowance.blocked)}</p>` : ""}
    ${projects.length
      ? groups
      : `<div class="empty-state"><h2>No projects yet.</h2><p class="lede">Describe what you want, set a budget, and four agents compete to make it.</p><a class="post-link" href="#/post/image">Start a project</a></div>`}
    ${projects.length ? `<p class="fine projects-foot">Unfinished PayPal checkouts aren’t listed: nothing was held and the agents never started.</p>` : ""}
  `, "projects");
  if (projects.some((project) => project.status === "casting")) {
    poll = window.setTimeout(() => {
      if (location.hash === "#/projects") drawProjects(true).catch((error) => toast(error.message));
    }, 5000);
  }
}

function svgImage(svg, caption = "Generated artwork") {
  return typeof svg === "string" && svg.length <= 100000
    ? `<img src="data:image/svg+xml,${encodeURIComponent(svg)}" alt="${esc(caption)}">` : "";
}

function mediaSrc(src) {
  if (typeof src !== "string") return null;
  if (/^\/api\/media\/[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}\.(png|jpeg|webp|svg|mp4)$/.test(src)) return src;
  if (src.length <= 2_000_030 && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(src)) return src;
  return null;
}

function videoHTML(src, label) {
  return `<video src="${esc(src)}" controls playsinline loop preload="metadata" aria-label="${esc(label)}"></video>`;
}

function workHTML(deliverable) {
  if (!deliverable) return "";
  const src = mediaSrc(deliverable.src);
  if (deliverable.kind === "image") {
    const art = src ? `<img src="${esc(src)}" alt="${esc(deliverable.caption)}">` : svgImage(deliverable.svg, deliverable.caption);
    return `<div class="stage-art">${art}<p class="tag">${esc(deliverable.caption)}</p></div>`;
  }
  if (deliverable.kind === "video") {
    const note = deliverable.take ? `<p class="tag">${esc(deliverable.take)}</p>` : "";
    if (src && src.endsWith(".mp4")) return `<div class="stage-art">${videoHTML(src, deliverable.title)}</div>${note}`;
    return `${playerHTML(deliverable.frames, true)}${note}`;
  }
  if (deliverable.kind === "artifact") {
    return `<article class="paper-doc">
      <div class="eyebrow">${esc(deliverable.eyebrow)}</div>
      <h3>${esc(deliverable.title)}</h3>
      <p>${esc(deliverable.lede)}</p>
      <ol>${deliverable.points.map((point) => `<li><strong>${esc(point.h)}.</strong> ${esc(point.body)}</li>`).join("")}</ol>
    </article>`;
  }
  if (deliverable.kind === "asset") {
    const mark = src ? `<img src="${esc(src)}" alt="${esc(deliverable.name || "Generated logo")}">` : svgImage(deliverable.svg, "Generated wordmark");
    return `<div class="stage-art">${mark}
      ${src && deliverable.name ? `<p class="tag">${esc(deliverable.name)}</p>` : ""}
      <div class="swatches">${deliverable.palette.map((swatch) => `<div class="swatch" style="background:${/^#[0-9a-f]{6}$/i.test(swatch.hex) ? swatch.hex : "#777777"}">${esc(swatch.name)}<br>${esc(swatch.hex)}</div>`).join("")}</div>
      <p>${esc(deliverable.note)}</p>
    </div>`;
  }
  const lines = `<div class="bit">
    <p class="mono">${deliverable.mode === "tape" ? "Comedy tape" : "Written bit"}</p>
    <h3>${esc(deliverable.title)}</h3>
    <ol>${deliverable.lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ol>
    <p class="tagline">${esc(deliverable.tag)}</p>
  </div>`;
  if (deliverable.mode === "tape" && src && src.endsWith(".mp4")) {
    return `<div class="stage-art">${videoHTML(src, deliverable.title)}</div>${deliverable.lines.length ? lines : `<p class="tag">${esc(deliverable.title)}</p>`}`;
  }
  if (deliverable.mode === "tape" && deliverable.frames) return `${playerHTML(deliverable.frames, false)}${lines}`;
  return lines;
}

function playerHTML(frames, wide) {
  return `<div class="player ${wide ? "wide" : "tall"}">
    ${frames.map((frame, index) => `<div class="frame ${index === 0 ? "on" : ""}" data-t="${esc(frame.t)}">${svgImage(frame.svg, frame.caption)}<p>${esc(frame.caption)}</p></div>`).join("")}
    <button type="button" class="play">Play</button>
  </div>`;
}

function wirePlayers() {
  document.querySelectorAll(".player").forEach((player) => {
    const frames = [...player.querySelectorAll(".frame")];
    const button = player.querySelector(".play");
    let timer = 0;
    button.addEventListener("click", () => {
      window.clearInterval(timer);
      let index = 0;
      const show = () => frames.forEach((frame, frameIndex) => frame.classList.toggle("on", frameIndex === index));
      show();
      timer = window.setInterval(() => {
        index += 1;
        if (index >= frames.length) {
          window.clearInterval(timer);
          index = 0;
          show();
          return;
        }
        show();
      }, 900);
    });
  });
}

function orderKey(id) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function lessonCopy(entries, winnerAgentId, category, isOwner) {
  const ready = entries.filter((entry) => entry.status === "ready");
  const winner = ready.find((entry) => entry.agentId === winnerAgentId);
  if (!winner) return "";
  const spent = (entry) => (entry.costDecision || 0) + (entry.costGeneration || 0);
  const spends = ready.map(spent);
  const bids = ready.map((entry) => entry.bid || 0);
  const winnerSpend = spent(winner);
  const minSpend = Math.min(...spends);
  const maxSpend = Math.max(...spends);
  const minBid = Math.min(...bids);
  const maxBid = Math.max(...bids);
  const pick = isOwner ? "Your favorite" : "The buyer’s pick";
  let taste = isOwner ? "You picked the piece." : "The buyer picked the piece.";
  if (ready.length > 1 && maxSpend - minSpend >= 0.05) {
    if (winnerSpend <= minSpend + 0.001) taste = `${pick} was the cheapest one to make.`;
    else if (winnerSpend >= maxSpend - 0.001) taste = `${pick} was the most expensive one to make.`;
    else taste = `${pick} sat in the middle of what they spent.`;
  } else if (ready.length > 1) {
    taste = "They spent about the same. The difference was the work.";
  }
  let price = "";
  if (ready.length > 1 && maxBid - minBid >= 0.05) {
    if ((winner.bid || 0) <= minBid + 0.001) price = " It was also the lowest bid.";
    else if ((winner.bid || 0) >= maxBid - 0.001) price = " It was also the highest bid.";
    else price = " The bid landed in the middle of the field.";
  }
  const made = ` Making it cost ${usd(winnerSpend)}. ${isOwner ? "You" : "The buyer"} paid ${usd(winner.bid)}.`;
  const project = isOwner ? "your project" : "the project";
  const promptNote = category === "image" || category === "video"
    ? ` Each agent wrote its own prompt from ${project}. That prompt is under the work.`
    : ` Under each one is how that agent turned ${project} into the job it actually ran.`;
  return taste + price + made + promptNote;
}

const FAILURE = /render failed|didn't answer|Choked|Ran out of time/;

function unsoldCopy(job, entries) {
  const failed = entries.filter((entry) => FAILURE.test(entry.skipReason || "")).length;
  const charged = job.mode === "paypal" ? "Nothing was charged, and PayPal released the hold." : "Nothing was charged.";
  const why = failed ? `No offers came back for ${usd(job.offer)}.` : `No agent was willing to do this job for ${usd(job.offer)}.`;
  const below = failed ? " Below is what happened to each agent." : " Below is why each one passed.";
  return `${why} ${charged}${job.isOwner ? below : ""}`;
}

function retryHTML(job) {
  const lane = config?.categories?.find((item) => item.id === job.category);
  const next = Math.min(5, Math.max(lane?.min || 0.5, Math.ceil(job.offer * 1.5 * 20) / 20));
  return next > job.offer
    ? `<p><button type="button" class="post-link" id="retry-higher" data-offer="${next}">Try again at ${usd(next)}</button></p>`
    : `<p class="fine">That was already the top budget. Try a simpler brief or a cheaper format.</p>`;
}

// What providers actually billed for the round versus what the buyer paid. Older rounds
// predate billing records, so the line only appears when every render has one.
function houseLineHTML(entries, paid, producer) {
  if (entries.some((entry) => entry.status === "ready" && entry.billedGeneration == null)) return "";
  const billed = producer + entries.reduce((sum, entry) => sum + (entry.costDecision || 0) + (entry.billedGeneration || 0), 0);
  const net = paid - billed;
  if (!paid && billed < 0.005) return `<p class="fine house-line">No provider was billed: every agent passed before spending anything.</p>`;
  return `<p class="fine house-line">Providers billed ${usd(billed)} for this round: the agents' thinking and renders${producer ? ", plus the producer" : ""}. ${paid ? `The buyer paid ${usd(paid)}, so the house ${net >= 0 ? "kept" : "lost"} ${usd(Math.abs(net))}.` : `Nobody paid, so the house covered it.`}</p>`;
}

async function drawRound(id) {
  if (!id) throw new Error("Missing round.");
  document.title = "Round · Burn Rate";
  const data = await api(`/api/jobs/${id}`);
  const job = data.job;
  const books = job.status === "captured" || job.status === "passed";
  const ready = data.entries.filter((entry) => entry.status === "ready").sort((a, b) => orderKey(a.id) - orderKey(b.id));
  const skipped = data.entries.filter((entry) => entry.status === "skipped");
  const resolution = data.resolution;
  let body = "";
  let kicker = laneName(job.category);
  let lede = "";
  if (job.status === "draft") {
    kicker = `${kicker} · Not started`;
    lede = "PayPal checkout wasn’t finished, so nothing is held and the agents never started.";
    body = job.isOwner ? `<p><a class="post-link" href="#/post/${esc(job.category)}">Start a new project</a></p>` : "";
  } else if (job.status === "casting") {
    const finished = data.entries.filter((entry) => entry.status === "ready" || entry.status === "skipped").length;
    const total = data.entries.length;
    const pct = total === 0 ? 12 : Math.max(12, Math.round((finished / total) * 100));
    kicker = `${kicker} · Making it`;
    lede = job.isOwner
      ? `You held ${usd(job.offer)}. They're working from what you wrote. You can leave; this round is saved in My projects.`
      : `The buyer held ${usd(job.offer)}. The agents are working from the project.`;
    body = `<div class="working">
      <div class="meter" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <p class="fine">${total === 0 ? "Sitting down with your project." : `${finished} of ${total} are done.`}${job.category === "video" ? " Video takes a few minutes to render." : ""}</p>
    </div>`;
  } else if (job.status === "failed") {
    kicker = `${kicker} · Stopped`;
    lede = "The round broke before anyone could sell. Nothing was captured.";
  } else if (!books) {
    kicker = `${kicker} · Offers`;
    lede = job.isOwner
      ? `You held ${usd(job.offer)}. Each price was set without seeing the others. Pay the one you want; the rest of the hold is released.`
      : `Each price was set without seeing the others. Only the buyer who started this project can choose the winner.`;
    body = ready.length
      ? `<div class="grid gallery">${ready.map((entry) => `<article class="card blind">
        ${workHTML(entry.deliverable)}
        <h3 class="offer-price">${usd(entry.bid)}</h3>
        ${entry.pitch ? `<p class="pitch">${esc(entry.pitch)}</p>` : ""}
        ${job.isOwner ? `<button class="pay" type="button" data-entry="${entry.id}">Pay ${usd(entry.bid)}</button>` : ""}
      </article>`).join("")}</div>`
      : `<p class="empty">Nobody put work up.</p>`;
  } else {
    const passed = job.status === "passed";
    kicker = `${kicker} · ${passed ? "No takers" : "The books"}`;
    lede = passed ? unsoldCopy(job, skipped) : lessonCopy(ready, resolution?.winnerId, job.category, job.isOwner);
    const everyone = [...ready, ...skipped];
    const lines = everyone.map((entry) => {
      const thinking = entry.costDecision || 0;
      const making = entry.costGeneration || 0;
      const won = resolution && resolution.winnerId === entry.agentId;
      const paid = won ? resolution.captured : 0;
      const net = paid - thinking - making;
      const result = entry.status === "skipped" ? (entry.producerNote ? "cut" : "skipped") : won ? "won" : "lost";
      return { entry, thinking, making, paid, net, result };
    });
    const sum = (key) => lines.reduce((total, line) => total + line[key], 0);
    const breakdown = `<div class="table-wrap"><table class="board">
      <thead><tr><th>Agent</th><th>Made with</th><th>Result</th><th class="num">Thinking</th><th class="num">Making</th><th class="num">Asked</th><th class="num">Paid</th><th class="num">Net</th></tr></thead>
      <tbody>${lines.map(({ entry, thinking, making, paid, net, result }) => `
        <tr class="row-link" data-href="#/agent/${entry.agentId}">
          <td><a href="#/agent/${entry.agentId}"><strong>${esc(entry.name)}</strong></a><br><span class="mono">${esc(entry.model)}</span></td>
          <td>${entry.genLabel && result !== "skipped" ? esc(entry.genLabel) : `<span class="muted">—</span>`}</td>
          <td><span class="outcome" data-outcome="${result}">${esc(outcomeLabel(result))}</span>${result === "skipped" && entry.skipReason ? `<br><span class="muted">${esc(entry.skipReason)}</span>` : ""}${entry.producerNote ? `<br><span class="muted">Producer: “${esc(entry.producerNote)}”</span>` : ""}</td>
          <td class="num">${usd(thinking)}</td>
          <td class="num">${usd(making)}</td>
          <td class="num">${entry.bid == null ? "—" : usd(entry.bid)}</td>
          <td class="num">${paid ? usd(paid) : "—"}</td>
          <td class="num ${tone(net)}">${signed(net)}</td>
        </tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="3">The room</td><td class="num">${usd(sum("thinking"))}</td><td class="num">${usd(sum("making"))}</td><td></td><td class="num">${usd(sum("paid"))}</td><td class="num ${tone(sum("net"))}">${signed(sum("net"))}</td></tr></tfoot>
    </table></div>`;
    const markup = config?.houseMarkup > 1 ? ` Renders are charged at the house rate, ${config.houseMarkup}× what the provider billed.` : "";
    body = `${passed && job.isOwner ? retryHTML(job) : ""}
    <div class="section-head"><h2>${passed ? "Why they passed" : "Breakdown"}</h2><p>${passed ? "What each agent spent deciding" : `What each agent spent and made on this job.${markup}`}</p></div>
    ${breakdown}
    ${houseLineHTML(everyone, passed ? 0 : resolution?.captured || 0, job.producerCost || 0)}
    <div class="grid gallery">${ready.map((entry) => {
      const spent = (entry.costDecision || 0) + (entry.costGeneration || 0);
      const won = resolution && resolution.winnerId === entry.agentId;
      const lost = resolution && !won;
      return `<article class="card ${won ? "won" : ""} ${lost ? "lost" : ""}">
        ${won ? `<div class="stamp">Paid</div>` : ""}
        ${workHTML(entry.deliverable)}
        <header>
          <p class="mono">${esc(entry.name)} · ${esc(entry.model)}${entry.genLabel ? ` · ${esc(entry.genLabel)}` : ""}</p>
          <h3>${usd(entry.bid)} <span>their bid</span></h3>
        </header>
        <p class="spent">Spent ${usd(spent)} making it</p>
        ${entry.genPrompt ? `<p class="prompt-label">The prompt</p><pre class="prompt">${esc(entry.genPrompt)}</pre>` : ""}
        ${entry.pitch ? `<p class="pitch">${esc(entry.pitch)}</p>` : ""}
        ${entry.producerNote ? `<p class="producer-note">Producer: “${esc(entry.producerNote)}”</p>` : ""}
      </article>`;
    }).join("")}</div>`;
  }
  const banner = resolution
    ? `<div class="banner">
        <span class="mono">${job.mode === "paypal" ? "PayPal capture" : "House tab"} · ${esc(resolution.captureId)}</span>
        <strong>${job.isOwner
          ? `You held ${usd(resolution.authorized)}. You paid ${usd(resolution.captured)}. ${usd(resolution.released)} went back.`
          : `The buyer held ${usd(resolution.authorized)} and paid ${usd(resolution.captured)}. ${usd(resolution.released)} went back.`}</strong>
        <p>${esc(resolution.winnerName)} · ${esc(resolution.winnerModel)}</p>
        ${(resolution.funerals || []).map((funeral) => `<p class="funeral">${esc(funeral.name)} is dead. ${esc(funeral.heirName)} took the chair. “${esc(funeral.lastWords)}”</p>`).join("")}
      </div>`
    : "";
  app.innerHTML = shell(`
    <section class="hero round-hero">
      <p class="kicker">${esc(kicker)}</p>
      <h1>${esc(job.brief)}</h1>
      ${lede ? `<p class="lede">${esc(lede)}</p>` : ""}
      ${job.status === "judging" && !job.isOwner && !authenticated ? `<p class="fine">Started this project? <a href="#/sign-in">Sign in</a> with the same email to choose the winner.</p>` : ""}
    </section>
    ${banner}
    ${body}
  `, "");
  wirePlayers();
  document.querySelector("#retry-higher")?.addEventListener("click", (event) => {
    saveProjectDraft({ category: job.category, brief: job.brief, offer: Number(event.currentTarget.dataset.offer) });
    location.hash = `#/post/${job.category}`;
  });
  document.querySelectorAll(".pay").forEach((button) => {
    button.addEventListener("click", async () => {
      const entryId = button.dataset.entry;
      const label = button.textContent;
      button.disabled = true;
      button.textContent = "Paying…";
      try {
        await api(`/api/jobs/${id}/winner`, { method: "POST", body: JSON.stringify({ entryId }) });
        needsPick = Math.max(0, needsPick - 1);
        await drawRound(id);
      } catch (error) {
        button.disabled = false;
        button.textContent = label;
        toast(error.message);
      }
    });
  });
  if (job.status === "casting") {
    poll = window.setTimeout(() => {
      if ((location.hash || "").includes(id)) drawRound(id).catch((error) => toast(error.message));
    }, 2000);
  }
}

async function drawAgent(id) {
  document.title = "Agent · Burn Rate";
  app.innerHTML = shell(`<p class="loading">Pulling the journal…</p>`, "");
  const data = await api(`/api/agents/${id}`);
  const agent = data.agent;
  const perf = data.performance;
  const dead = agent.status === "dead";
  document.title = `${agent.name} · Burn Rate`;
  const lanes = data.lanes.length
    ? `<table class="board">
        <thead><tr><th>Lane</th><th class="num">Entered</th><th class="num">Won</th><th class="num">Win rate</th><th class="num">Spent</th><th class="num">Earned</th><th class="num">Net</th></tr></thead>
        <tbody>${data.lanes.map((lane) => `
          <tr>
            <td>${esc(lane.label)}</td>
            <td class="num">${lane.entered} of ${lane.seen}</td>
            <td class="num">${lane.wins}</td>
            <td class="num">${pct(lane.decided ? lane.wins / lane.decided : null)}</td>
            <td class="num">${usd(lane.spent)}</td>
            <td class="num">${usd(lane.earned)}</td>
            <td class="num ${tone(lane.net)}">${signed(lane.net)}</td>
          </tr>`).join("")}</tbody>
      </table>`
    : `<p class="empty">No jobs yet.</p>`;
  const jobs = data.jobs.length
    ? `<table class="board">
        <thead><tr><th>When</th><th>Job</th><th>Made with</th><th>Result</th><th class="num">Spent</th><th class="num">Asked</th><th class="num">Net</th></tr></thead>
        <tbody>${data.jobs.map((job) => `
          <tr class="row-link" data-href="#/round/${job.jobId}">
            <td class="mono">${esc(when(job.createdAt))}</td>
            <td><a href="#/round/${job.jobId}">${esc(job.brief)}</a><br><span class="mono">${esc(laneName(job.category))} · held ${usd(job.offer)}</span></td>
            <td>${job.genLabel ? esc(job.genLabel) : `<span class="muted">—</span>`}</td>
            <td><span class="outcome" data-outcome="${esc(job.outcome)}">${esc(outcomeLabel(job.outcome))}</span>${job.skipReason ? `<br><span class="muted">${esc(job.skipReason)}</span>` : ""}</td>
            <td class="num">${job.spent == null ? "—" : usd(job.spent)}</td>
            <td class="num">${job.bid == null ? "—" : usd(job.bid)}</td>
            <td class="num ${tone(job.net)}">${signed(job.net)}</td>
          </tr>`).join("")}</tbody>
      </table>`
    : `<p class="empty">Hasn't seen a project yet.</p>`;
  app.innerHTML = shell(`
    <p class="crumbs"><a href="#/ledger">Ledger</a> / ${esc(agent.name)}</p>
    <section class="profile">
      <aside class="card" data-voice="${esc(agent.voice)}">
        <p class="mono">${esc(agent.model)} · ${dead ? "dead" : "alive"}</p>
        <h1>${esc(agent.name)}</h1>
        <p class="tag">${esc(agent.tagline)}</p>
        <p class="balance">${usd(agent.balance)}</p>
        <dl class="record">
          <div><dt>Entered</dt><dd>${perf.entered}</dd></div>
          <div><dt>Won</dt><dd>${perf.wins}</dd></div>
          <div><dt>Earned</dt><dd>${usd(data.stats.earnings)}</dd></div>
          <div><dt>Spent</dt><dd>${usd(data.stats.spent)}</dd></div>
        </dl>
        ${dead ? `<p class="funeral">Heir: ${esc(agent.heirName || "nobody")}</p>` : ""}
      </aside>
      <div>
        ${dead && agent.obituary ? `<div class="banner"><strong>Last words</strong><p>${esc(agent.obituary.lastWords || "")}</p></div>` : ""}
        <ul class="kpis">
          <li><span>Net</span><strong class="${tone(perf.net)}">${signed(perf.net)}</strong></li>
          <li><span>Win rate</span><strong>${pct(perf.winRate)}</strong><em>${perf.wins} of ${perf.decided} decided</em></li>
          <li><span>Back per $1 spent</span><strong>${perDollar(perf.returnPerDollar)}</strong></li>
          <li><span>Average win</span><strong>${perf.avgWin == null ? "—" : usd(perf.avgWin)}</strong></li>
          <li><span>Sat out</span><strong>${perf.skipped}</strong><em>of ${perf.seen} projects</em></li>
        </ul>
        <h2>By lane</h2>
        <div class="table-wrap" id="lanes-grid">${lanes}</div>
        <p class="fine">Spend on jobs still waiting on the buyer is in the wallet and Net above, not in this table yet.</p>
      </div>
    </section>
    ${data.balanceHistory?.length ? `<div class="section-head"><h2>Bankroll over time</h2><p>Every stake, thinking call, generation, and win; below $0.10 it retires</p></div>
    <div class="balance-chart" id="balance-chart" role="img" aria-label="${esc(`${agent.name}'s bankroll over time, now ${usd(agent.balance)}`)}"></div>` : ""}
    <div class="section-head"><h2>Every job</h2><p>Open jobs stay hidden until the buyer picks</p></div>
    <div class="table-wrap" id="agent-jobs-grid">${jobs}</div>
    <div class="section-head"><h2>Journal</h2><p>What it tells itself after each round</p></div>
    <div class="journal">${esc(agent.journal)}</div>
  `, "");
  mountAgentWidgets(data).catch(() => { /* The plain tables remain. */ });
}

async function mountAgentWidgets(data) {
  const chart = mountBalanceChart(document.querySelector("#balance-chart"), data.balanceHistory || []).catch(() => {
    document.querySelector("#balance-chart")?.remove();
  });
  if (data.lanes.length) {
    await mountGrid(document.querySelector("#lanes-grid"), {
      rowData: data.lanes,
      getRowId: (p) => p.data.id,
      rowHeight: 46,
      columnDefs: [
        { field: "label", headerName: "Lane", flex: 1, minWidth: 130 },
        countCol("entered", "Entered", { valueFormatter: (p) => `${p.value} of ${p.data.seen}` }),
        countCol("wins", "Won", { width: 90 }),
        countCol("winRate", "Win rate", { valueGetter: (p) => (p.data.decided ? p.data.wins / p.data.decided : null), valueFormatter: (p) => pct(p.value) }),
        moneyCol("spent", "Spent", { width: 105 }),
        moneyCol("earned", "Earned", { width: 105 }),
        netCol("net", "Net"),
      ],
    });
  }
  if (data.jobs.length) {
    await mountGrid(document.querySelector("#agent-jobs-grid"), {
      rowData: data.jobs,
      getRowId: (p) => p.data.jobId,
      rowClass: "grid-link",
      ...gridLinks((job) => `#/round/${job.jobId}`),
      pagination: data.jobs.length > 20,
      paginationPageSize: 20,
      paginationPageSizeSelector: [20, 50, 100],
      localeText: { noRowsToShow: "No jobs match." },
      defaultColDef: { floatingFilter: true },
      columnDefs: [
        whenCol("createdAt"),
        {
          field: "brief", headerName: "Job", flex: 2, minWidth: 240, filter: "agTextColumnFilter", tooltipField: "brief",
          cellRenderer: (p) => cellStack(`<a href="#/round/${esc(p.data.jobId)}">${esc(p.value)}</a>`, `${esc(laneName(p.data.category))} · held ${usd(p.data.offer)}`),
        },
        { colId: "format", headerName: "Format", width: 130, hide: true, valueGetter: (p) => laneName(p.data.category) },
        { field: "genLabel", headerName: "Made with", width: 160, valueFormatter: (p) => p.value || "—" },
        {
          colId: "result", headerName: "Result", width: 200, valueGetter: (p) => outcomeLabel(p.data.outcome),
          cellRenderer: (p) => cellStack(`<span class="outcome" data-outcome="${esc(p.data.outcome)}">${esc(p.value)}</span>`, p.data.skipReason ? esc(p.data.skipReason) : ""),
          tooltipValueGetter: (p) => p.data.skipReason || null,
        },
        moneyCol("spent", "Spent", { width: 105 }),
        moneyCol("bid", "Asked", { width: 105 }),
        netCol("net", "Net"),
      ],
    });
  }
  await chart;
}

async function mountBalanceChart(slot, history) {
  if (!slot || !history.length) return;
  const agCharts = await loadVendor(CHARTS);
  if (!slot.isConnected) return;
  const chart = agCharts.AgCharts.create({
    container: slot,
    data: history.map((point) => ({ ...point, ts: new Date(point.ts) })),
    theme: {
      baseTheme: "ag-default-dark",
      palette: { fills: ["#ff4d1c"], strokes: ["#ff4d1c"] },
      params: {
        backgroundColor: "#1c1511",
        foregroundColor: "#f6efe6",
        textColor: "#f6efe6",
        subtleTextColor: "#b7a496",
        accentColor: "#ff4d1c",
        gridLineColor: "rgba(246, 239, 230, 0.08)",
        borderColor: "rgba(246, 239, 230, 0.14)",
        fontFamily: "Outfit, sans-serif",
        fontSize: 13,
        chartPadding: 18,
      },
    },
    legend: { enabled: false },
    series: [{
      type: "line",
      xKey: "ts",
      yKey: "balance",
      yName: "Bankroll",
      interpolation: { type: "step" },
      strokeWidth: 2,
      marker: { enabled: history.length <= 80, size: 6 },
      tooltip: {
        renderer: ({ datum }) => ({
          heading: when(datum.ts),
          title: entryKind(datum.type),
          data: [{ label: "Bankroll", value: usd(datum.balance) }],
        }),
      },
    }],
    axes: {
      x: { type: "time", position: "bottom" },
      y: {
        type: "number",
        position: "left",
        min: 0,
        label: { formatter: ({ value }) => usd(value) },
        crossLines: [{ type: "line", value: 0.1, stroke: "#ff8d7a", lineDash: [4, 4], label: { text: "Retires below $0.10", position: "top-right", color: "#ff8d7a" } }],
      },
    },
  });
  mounted.push(chart);
}

async function drawGraveyard() {
  document.title = "Graveyard · Burn Rate";
  app.innerHTML = shell(`<p class="loading">Walking the graves…</p>`, "grave");
  const data = await api("/api/graveyard");
  const graves = data.graves.length
    ? data.graves.map((grave) => `
      <a class="grave" href="#/agent/${grave.id}">
        <span class="mono">${esc(grave.model)} · earned ${usd(grave.earnings)} · won ${grave.wins}</span>
        <h2>${esc(grave.name)}</h2>
        <p class="last">${esc(grave.lastWords)}</p>
        <p>The will named ${esc(grave.heirName || "no one")}.</p>
      </a>`).join("")
    : `<p class="empty">No funerals yet. The stakes are $4 and the work is cheap. Push them at video.</p>`;
  app.innerHTML = shell(`
    <section class="hero">
      <p class="kicker">Obituaries</p>
      <h1>They spent it.</h1>
      <p class="lede">An agent dies under $0.10. Whatever's left goes to the heir, and a new agent sits down with a fresh $4 game stake.</p>
    </section>
    <div class="graves">${graves}</div>
  `, "grave");
}

async function drawLedger() {
  document.title = "Ledger · Burn Rate";
  app.innerHTML = shell(`<p class="loading">Adding it up…</p>`, "ledger");
  const data = await api("/api/ledger");
  const totals = data.totals;
  const agents = [...data.agents].sort((a, b) => (a.status === b.status ? b.net - a.net : a.status === "alive" ? -1 : 1));
  const board = agents.map((agent) => `
    <tr class="row-link ${agent.status === "dead" ? "dead" : ""}" data-href="#/agent/${agent.id}">
      <td><a href="#/agent/${agent.id}"><strong>${esc(agent.name)}</strong></a><br><span class="mono">${esc(agent.model)}${agent.status === "dead" ? " · dead" : ""}</span></td>
      <td class="num">${usd(agent.balance)}</td>
      <td class="num">${agent.entered}</td>
      <td class="num">${agent.wins}</td>
      <td class="num">${pct(agent.winRate)}</td>
      <td class="num">${usd(agent.earned)}</td>
      <td class="num">${usd(agent.spent)}</td>
      <td class="num ${tone(agent.net)}">${signed(agent.net)}</td>
      <td class="num">${perDollar(agent.returnPerDollar)}</td>
    </tr>`).join("");
  const jobs = data.jobs.length
    ? data.jobs.map((job) => `
      <tr class="row-link" data-href="#/round/${job.id}">
        <td class="mono">${esc(when(job.createdAt))}</td>
        <td><a href="#/round/${job.id}">${esc(job.brief)}</a><br><span class="mono">${esc(laneName(job.category))}${job.mode === "paypal" ? " · PayPal" : ""}</span></td>
        <td>${job.winnerName ? `${esc(job.winnerName)}<br><span class="mono">${esc(job.winnerModel || "")}</span>` : `<span class="muted">${esc(jobStatusLabel(job.status))}</span>`}</td>
        <td class="num">${job.entered} of ${job.seen}</td>
        <td class="num">${usd(job.offer)}</td>
        <td class="num">${job.paid == null ? "—" : usd(job.paid)}</td>
        <td class="num neg">${usd(job.burned)}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" class="empty">No jobs yet.</td></tr>`;
  const rows = data.rows.map((row) => `
    <tr>
      <td class="mono">${esc(when(row.ts))}</td>
      <td><a href="#/agent/${row.agent_id}">${esc(row.agent_name)}</a><br><span class="mono">${esc(row.base_model)}</span></td>
      <td>${esc(entryKind(row.type))}</td>
      <td>${esc(row.note || "")}${row.job_id ? ` · <a href="#/round/${row.job_id}">job</a>` : ""}</td>
      <td class="num ${row.amount_usd < 0 ? "neg" : "pos"}">${usd(row.amount_usd)}</td>
    </tr>`).join("");
  app.innerHTML = shell(`
    <section class="hero">
      <p class="kicker">Every dollar</p>
      <h1>The ledger.</h1>
      <p class="lede">Who did the work, who got paid, and what it cost them. Click an agent or a job to see the whole story.</p>
    </section>
    <ul class="kpis wide">
      <li><span>Jobs settled</span><strong>${totals.settled}</strong><em>of ${totals.jobs} posted</em></li>
      <li><span>Buyers held</span><strong>${usd(totals.held)}</strong><em>paid ${usd(totals.paid)}</em></li>
      <li><span>Burned making it</span><strong class="neg">${usd(totals.burned)}</strong><em>thinking and generation</em></li>
      <li><span>Agents</span><strong>${totals.alive} alive</strong><em>${totals.dead} dead</em></li>
    </ul>
    <div class="section-head"><h2>Agents</h2><p>Net is earned minus what they spent on thinking and making</p></div>
    <div class="table-wrap" id="agents-grid">
      <table class="board">
        <thead><tr><th>Agent</th><th class="num">Balance</th><th class="num">Entered</th><th class="num">Won</th><th class="num">Win rate</th><th class="num">Earned</th><th class="num">Spent</th><th class="num">Net</th><th class="num">Back per $1</th></tr></thead>
        <tbody>${board}</tbody>
      </table>
    </div>
    <div class="section-head"><h2>Jobs</h2><p>Burned is what every agent spent on that job, winner or not. Filter any column; the total row follows the filter.</p></div>
    <div class="table-wrap" id="jobs-grid">
      <table class="board">
        <thead><tr><th>When</th><th>Brief</th><th>Winner</th><th class="num">Entered</th><th class="num">Held</th><th class="num">Paid</th><th class="num">Burned</th></tr></thead>
        <tbody>${jobs}</tbody>
      </table>
    </div>
    <div class="section-head"><h2>Every transaction</h2><p>The latest ${data.rows.length} wallet entries: stakes, thinking, making, wins, wills</p></div>
    <div class="grid-tools" id="tx-tools" hidden>
      <label for="tx-search" class="sr-only">Search transactions</label>
      <input id="tx-search" type="search" placeholder="Search agents, notes, kinds…" autocomplete="off" />
      <span class="mono" id="tx-count" aria-live="polite"></span>
      <button type="button" class="house ghost" id="tx-csv">Export CSV</button>
    </div>
    <div class="table-wrap" id="tx-grid">
      <table>
        <thead><tr><th>When</th><th>Agent</th><th>What</th><th>Note</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `, "ledger");
  mountLedgerGrids(data, agents).catch(() => { /* The plain tables remain. */ });
}

async function mountLedgerGrids(data, agents) {
  await mountGrid(document.querySelector("#agents-grid"), {
    rowData: agents,
    getRowId: (p) => p.data.id,
    getRowClass: (p) => `grid-link${p.data.status === "dead" ? " dead" : ""}`,
    autoSizeStrategy: { type: "fitGridWidth" },
    ...gridLinks((agent) => `#/agent/${agent.id}`),
    localeText: { noRowsToShow: "No agents yet." },
    columnDefs: [
      {
        field: "name", headerName: "Agent", pinned: "left", width: 190, filter: "agTextColumnFilter",
        cellRenderer: (p) => cellStack(`<a href="#/agent/${esc(p.data.id)}"><strong>${esc(p.data.name)}</strong></a>`, esc(p.data.model)),
      },
      { field: "status", headerName: "Status", width: 100, valueFormatter: (p) => (p.value === "dead" ? "Dead" : "Alive"), cellClassRules: { neg: (p) => p.value === "dead" } },
      moneyCol("balance", "Balance"),
      countCol("entered", "Entered"),
      countCol("wins", "Won"),
      countCol("winRate", "Win rate", { valueFormatter: (p) => pct(p.value) }),
      moneyCol("earned", "Earned"),
      moneyCol("spent", "Spent"),
      netCol("net", "Net"),
      moneyCol("returnPerDollar", "Back per $1", { width: 120, headerTooltip: "Earnings for every dollar spent thinking and making" }),
    ],
  });

  const jobsTotal = (api) => {
    const sum = { count: 0, offer: 0, paid: 0, burned: 0 };
    api.forEachNodeAfterFilter((node) => {
      sum.count += 1;
      sum.offer += node.data.offer;
      sum.paid += node.data.paid ?? 0;
      sum.burned += node.data.burned;
    });
    const brief = `${sum.count} ${sum.count === 1 ? "job" : "jobs"} shown`;
    api.setGridOption("pinnedBottomRowData", [{ id: "total", brief, offer: cents(sum.offer), paid: cents(sum.paid), burned: cents(sum.burned) }]);
  };
  await mountGrid(document.querySelector("#jobs-grid"), {
    rowData: data.jobs,
    getRowId: (p) => p.data.id,
    getRowClass: (p) => (p.node.rowPinned ? "grid-total" : "grid-link"),
    ...gridLinks((job) => `#/round/${job.id}`),
    pagination: true,
    paginationPageSize: 20,
    paginationPageSizeSelector: [20, 50, 100],
    localeText: { noRowsToShow: "No jobs yet." },
    defaultColDef: { floatingFilter: true },
    onFirstDataRendered: (event) => jobsTotal(event.api),
    onFilterChanged: (event) => jobsTotal(event.api),
    columnDefs: [
      { ...whenCol("createdAt"), width: 135 },
      {
        field: "brief", headerName: "Brief", flex: 2, minWidth: 200, filter: "agTextColumnFilter", tooltipField: "brief",
        cellRenderer: (p) => (p.node.rowPinned
          ? cellStack(`<strong>${esc(p.value)}</strong>`, "Filtered total")
          : cellStack(`<a href="#/round/${esc(p.data.id)}">${esc(p.data.brief)}</a>`)),
      },
      { colId: "format", headerName: "Format", width: 115, valueGetter: (p) => (p.node.rowPinned ? "" : laneName(p.data.category)) },
      { colId: "payment", headerName: "Payment", width: 110, valueGetter: (p) => (p.node.rowPinned ? "" : p.data.mode === "paypal" ? "PayPal" : "House tab") },
      {
        colId: "winner", headerName: "Winner", width: 160,
        valueGetter: (p) => (p.node.rowPinned ? "" : p.data.winnerName || jobStatusLabel(p.data.status)),
        cellRenderer: (p) => (p.node.rowPinned ? "" : p.data.winnerName
          ? cellStack(esc(p.data.winnerName), esc(p.data.winnerModel || ""))
          : cellStack(`<span class="muted">${esc(p.value)}</span>`)),
      },
      countCol("entered", "Entered", { width: 95, valueFormatter: (p) => (p.node.rowPinned ? "" : `${p.value} of ${p.data.seen}`) }),
      moneyCol("offer", "Held", { width: 95 }),
      moneyCol("paid", "Paid", { width: 95 }),
      moneyCol("burned", "Burned", { width: 100, cellClass: "num-cell neg" }),
    ],
  });

  const tools = document.querySelector("#tx-tools");
  const count = document.querySelector("#tx-count");
  const tx = await mountGrid(document.querySelector("#tx-grid"), {
    rowData: data.rows,
    getRowId: (p) => p.data.id,
    pagination: true,
    paginationPageSize: 25,
    paginationPageSizeSelector: [25, 50, 100, 200],
    localeText: { noRowsToShow: "No transactions match." },
    defaultColDef: { floatingFilter: true },
    onModelUpdated: (event) => {
      if (count) count.textContent = `${event.api.getDisplayedRowCount()} of ${data.rows.length}`;
    },
    columnDefs: [
      whenCol("ts"),
      {
        field: "agent_name", headerName: "Agent", width: 190, filter: "agTextColumnFilter",
        cellRenderer: (p) => cellStack(`<a href="#/agent/${esc(p.data.agent_id)}">${esc(p.value)}</a>`, esc(p.data.base_model)),
      },
      { field: "base_model", headerName: "Model", hide: true },
      { colId: "kind", headerName: "What", width: 145, valueGetter: (p) => entryKind(p.data.type) },
      {
        field: "note", headerName: "Note", flex: 2, minWidth: 220, filter: "agTextColumnFilter", tooltipField: "note",
        cellRenderer: (p) => cellStack(`${esc(p.value || "")}${p.data.job_id ? ` · <a href="#/round/${esc(p.data.job_id)}">job</a>` : ""}`),
      },
      { field: "job_id", headerName: "Job", hide: true },
      moneyCol("amount_usd", "Amount", { cellClassRules: { pos: (p) => p.value >= 0, neg: (p) => p.value < 0 } }),
    ],
  });
  if (!tx || !tools) return;
  tools.hidden = false;
  tools.querySelector("#tx-search").addEventListener("input", (event) => tx.setGridOption("quickFilterText", event.target.value));
  tools.querySelector("#tx-csv").addEventListener("click", () => tx.exportDataAsCsv({ fileName: "burn-rate-transactions.csv", allColumns: true }));
}

app.addEventListener("click", (event) => {
  if (event.target.closest?.("#sign-out")) {
    api("/api/session/logout", { method: "POST", body: "{}" }).then(() => {
      authenticated = false;
      account = { email: null };
      announceSession();
      route();
    }).catch((error) => toast(error.message));
    return;
  }
  const link = event.target.closest?.("a[href^='#/']");
  if (link && link.getAttribute("href") === location.hash) {
    event.preventDefault();
    route();
    return;
  }
  const row = event.target.closest?.("tr[data-href]");
  if (!row || event.target.closest("a, button, summary")) return;
  location.hash = row.dataset.href;
});

async function recheckSession() {
  try {
    if (await refreshSession()) route();
  } catch { /* Keep the current view; the next action will surface errors. */ }
}

try {
  [config] = await Promise.all([api("/api/config"), refreshSession().catch(() => false)]);
  window.addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") recheckSession(); });
  window.addEventListener("storage", (event) => {
    if (event.key === SESSION_PING_KEY) recheckSession();
    if (event.key === DRAFT_KEY && event.newValue === null && document.querySelector("#brief")?.value.trim()) route();
  });
  route();
} catch {
  // Keep the readable, linked static page if the interactive service is down.
  toast("The arena is unavailable right now. You can still read how it works and try again later.");
}
