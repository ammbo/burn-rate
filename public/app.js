const app = document.querySelector("#app");
const toastEl = document.querySelector("#toast");
let poll = 0;
let paypalPromise = null;
let config = null;

const usd = (value) => {
  const amount = Number(value) || 0;
  const sign = amount < 0 ? "−" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
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
  ({ won: "Won", lost: "Lost", skipped: "Sat out", open: "Waiting on the buyer", failed: "Round broke" })[outcome] || outcome;

const jobStatusLabel = (status) =>
  ({ casting: "Being made", judging: "Waiting on the buyer", captured: "Paid", failed: "Broke" })[status] || status;

const laneName = (id) =>
  ({ image: "Image", video: "Video", artifact: "Artifact", asset: "Asset", standup: "Stand-up" })[id] || id;

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

function shell(main, active) {
  return `<div class="page">
    <header class="bar">
      <a class="brand" href="#/">Burn Rate</a>
      <nav>
        <a href="#/" class="${active === "arena" ? "on" : ""}">Arena</a>
        <a href="#/graveyard" class="${active === "grave" ? "on" : ""}">Graveyard</a>
        <a href="#/ledger" class="${active === "ledger" ? "on" : ""}">Ledger</a>
      </nav>
      <a class="post-link" href="#/post/image">Put up a job</a>
    </header>
    ${main}
  </div>`;
}

function route() {
  window.clearTimeout(poll);
  const parts = (location.hash || "#/").replace(/^#\/?/, "").split("/").filter(Boolean);
  const name = parts[0] || "arena";
  const go = {
    arena: () => drawArena(),
    post: () => drawArena(parts[1] || "image"),
    round: () => drawRound(parts[1]),
    agent: () => drawAgent(parts[1]),
    graveyard: () => drawGraveyard(),
    ledger: () => drawLedger(),
  }[name];
  if (!go) {
    location.hash = "#/";
    return;
  }
  go().catch((error) => {
    toast(error.message);
    app.innerHTML = shell(`<p class="loading">${esc(error.message)}</p>`, "");
  });
}

async function drawArena(selected = "image") {
  document.title = "Burn Rate";
  app.innerHTML = shell(`<p class="loading">Checking the wallets…</p>`, "arena");
  const data = await api("/api/arena");
  const lanes = config?.categories || [];
  const current = lanes.some((lane) => lane.id === selected) ? selected : "image";
  const lane = lanes.find((item) => item.id === current) || lanes[0];
  const paypal = Boolean(config?.paypal);
  const chips = lanes.map((item) => `
    <label class="chip">
      <input type="radio" name="lane" value="${item.id}" ${item.id === current ? "checked" : ""} />
      ${esc(item.label)}
    </label>`).join("");
  const agents = data.agents.map((agent) => `
    <a class="agent" data-voice="${esc(agent.voice)}" href="#/agent/${agent.id}">
      <div class="agent-top"><span class="model">${esc(agent.model)}</span><span class="balance">${usd(agent.balance)}</span></div>
      <h2>${esc(agent.name)}</h2>
      <p class="tag">${esc(agent.tagline)}</p>
      <dl class="record">
        <div><dt>Won</dt><dd>${agent.wins}</dd></div>
        <div><dt>Sold</dt><dd>${agent.entries}</dd></div>
        <div><dt>Earned</dt><dd>${usd(agent.earnings)}</dd></div>
      </dl>
    </a>`).join("");
  const live = data.live.length
    ? data.live.map((job) => `
      <a class="job-row" href="#/round/${job.id}">
        <span class="pill">${esc(laneName(job.category))}</span>
        <span><strong>${esc(job.brief)}</strong><span>${job.status === "judging" ? "Ready to pick" : "Being made"} · you held ${usd(job.offer)}</span></span>
        <span class="pill">${job.status === "judging" ? "Needs you" : "Live"}</span>
      </a>`).join("")
    : `<p class="empty">Nothing in progress. Write something above.</p>`;
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
  app.innerHTML = shell(`
    <section class="ask" id="ask">
      <p class="kicker">Four models read this. They price without seeing each other.</p>
      <h1>What do you want?</h1>
      <form id="job-form">
        <textarea id="brief" class="brief-box" maxlength="400" placeholder="${esc(lane?.placeholder || "")}"></textarea>
        <p class="hint" id="brief-hint"></p>
        <div class="chips" role="radiogroup" aria-label="Kind of work">${chips}</div>
        <p class="blurb" id="lane-blurb">${esc(lane?.blurb || "")}</p>
        <label class="offer">
          <span>Your bid</span>
          <strong id="offer-read">${usd(lane?.suggestion || 2)}</strong>
          <input id="offer" type="range" min="0.5" max="5" step="0.05" value="${lane?.suggestion || 2}" aria-label="Your bid" />
        </label>
        <p class="fine" id="fine"></p>
        <div class="actions">
          ${paypal ? `<div id="paypal"></div>` : ""}
          <button class="house ${paypal ? "ghost" : ""}" type="button" id="house">${paypal ? "Or hold it on the house tab" : "Hold it on the house tab"}</button>
        </div>
        ${paypal ? "" : `<p class="fine">Sandbox keys aren't in this room, so the house holds the bid and records the capture here.</p>`}
      </form>
    </section>
    <div class="section-head"><h2>The room</h2><p>Burned ${usd(data.stats.burned)} · paid ${usd(data.stats.paid)}</p></div>
    <div class="agents">${agents}</div>
    <div class="section-head"><h2>On the board</h2><p>Jobs in motion</p></div>
    <div class="jobs">${live}</div>
    ${recent ? `<div class="section-head"><h2>Last picks</h2><p>What your eye actually paid</p></div><div class="jobs">${recent}</div>` : ""}
    <div class="section-head"><h2>Graveyard</h2><p>Wallets that hit the floor</p></div>
    ${graves}
  `, "arena");
  wireAsk(lanes);
  if ((location.hash || "").startsWith("#/post")) document.querySelector("#brief")?.focus();
}

function wireAsk(lanes) {
  const offer = document.querySelector("#offer");
  const offerRead = document.querySelector("#offer-read");
  const fine = document.querySelector("#fine");
  const brief = document.querySelector("#brief");
  const hint = document.querySelector("#brief-hint");
  const blurb = document.querySelector("#lane-blurb");
  const paypal = Boolean(config?.paypal);
  let touched = false;
  const sync = () => {
    offerRead.textContent = usd(offer.value);
    const hold = paypal ? "PayPal holds" : "The house tab holds";
    fine.textContent = `${hold} ${usd(offer.value)}. Each model sets a price in the dark, then you see every offer next to the work. You pay the one you pick, and the rest is released.`;
    const count = brief.value.trim().length;
    hint.textContent = count > 0 && count < 12 ? "A little more, so they have something to interpret." : "";
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
      blurb.textContent = next.blurb;
      if (!touched) {
        offer.value = String(next.suggestion);
        sync();
      }
    });
  });
  document.querySelector("#house").addEventListener("click", () => submitHouse());
  if (paypal) mountPaypal().catch((error) => toast(error.message));
}

function readForm() {
  const category = document.querySelector("input[name=lane]:checked")?.value;
  const brief = document.querySelector("#brief").value.trim();
  const offer = Math.round(Number(document.querySelector("#offer").value) * 100) / 100;
  if (!category) return { error: "Pick what kind of thing you want." };
  if (brief.length < 12) return { error: "Give them at least 12 characters." };
  if (offer < 0.5 || offer > 5) return { error: "The bid stays between $0.50 and $5.00." };
  return { category, brief, offer };
}

async function submitHouse() {
  const posted = readForm();
  if (posted.error) {
    toast(posted.error);
    return;
  }
  const button = document.querySelector("#house");
  button.disabled = true;
  try {
    const created = await api("/api/jobs", { method: "POST", body: JSON.stringify({ ...posted, mode: "house" }) });
    location.hash = `#/round/${created.jobId}`;
  } catch (error) {
    button.disabled = false;
    toast(error.message);
  }
}

function loadPaypal(clientId) {
  if (window.paypal) return Promise.resolve();
  if (!paypalPromise) {
    paypalPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&intent=authorize&currency=USD&disable-funding=card,credit,venmo`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("PayPal's button didn't load."));
      document.head.appendChild(script);
    });
  }
  return paypalPromise;
}

async function mountPaypal() {
  await loadPaypal(config.paypalClientId);
  const slot = document.querySelector("#paypal");
  if (!slot || !window.paypal) return;
  let jobId = "";
  window.paypal.Buttons({
    style: { color: "gold", shape: "pill", label: "paypal", height: 46 },
    createOrder: async () => {
      const posted = readForm();
      if (posted.error) {
        toast(posted.error);
        throw new Error(posted.error);
      }
      const created = await api("/api/jobs", { method: "POST", body: JSON.stringify({ ...posted, mode: "paypal" }) });
      jobId = created.jobId;
      return created.orderId;
    },
    onApprove: async (data) => {
      await api(`/api/jobs/${jobId}/authorize`, { method: "POST", body: JSON.stringify({ orderId: data.orderID }) });
      location.hash = `#/round/${jobId}`;
    },
    onError: (error) => toast(error?.message || "PayPal stopped the authorization."),
    onCancel: () => toast("Authorization cancelled. The job is still a draft."),
  }).render(slot);
}

function workHTML(deliverable) {
  if (!deliverable) return "";
  if (deliverable.kind === "image") {
    return `<div class="stage-art">${deliverable.svg}<p class="tag">${esc(deliverable.caption)}</p></div>`;
  }
  if (deliverable.kind === "video") {
    const note = deliverable.take ? `<p class="tag">${esc(deliverable.take)}</p>` : "";
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
    return `<div class="stage-art">${deliverable.svg}
      <div class="swatches">${deliverable.palette.map((swatch) => `<div class="swatch" style="background:${esc(swatch.hex)}">${esc(swatch.name)}<br>${esc(swatch.hex)}</div>`).join("")}</div>
      <p>${esc(deliverable.note)}</p>
    </div>`;
  }
  const lines = `<div class="bit">
    <p class="mono">${deliverable.mode === "tape" ? "Comedy tape" : "Written bit"}</p>
    <h3>${esc(deliverable.title)}</h3>
    <ol>${deliverable.lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ol>
    <p class="tagline">${esc(deliverable.tag)}</p>
  </div>`;
  if (deliverable.mode === "tape" && deliverable.frames) return `${playerHTML(deliverable.frames, false)}${lines}`;
  return lines;
}

function playerHTML(frames, wide) {
  return `<div class="player ${wide ? "wide" : "tall"}">
    ${frames.map((frame, index) => `<div class="frame ${index === 0 ? "on" : ""}" data-t="${esc(frame.t)}">${frame.svg}<p>${esc(frame.caption)}</p></div>`).join("")}
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

function lessonCopy(entries, winnerAgentId, category) {
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
  let taste = "You picked the piece.";
  if (ready.length > 1 && maxSpend - minSpend >= 0.05) {
    if (winnerSpend <= minSpend + 0.001) taste = "Your favorite was the cheapest one to make.";
    else if (winnerSpend >= maxSpend - 0.001) taste = "Your favorite was the most expensive one to make.";
    else taste = "Your favorite sat in the middle of what they spent.";
  } else if (ready.length > 1) {
    taste = "They spent about the same. The difference was the work.";
  }
  let price = "";
  if (ready.length > 1 && maxBid - minBid >= 0.05) {
    if ((winner.bid || 0) <= minBid + 0.001) price = " It was also the lowest bid.";
    else if ((winner.bid || 0) >= maxBid - 0.001) price = " It was also the highest bid.";
    else price = " The bid landed in the middle of the field.";
  }
  const made = ` Making it cost ${usd(winnerSpend)}. You paid ${usd(winner.bid)}.`;
  const promptNote = category === "image" || category === "video"
    ? " Each model wrote its own prompt from your brief. That prompt is under the work."
    : " Under each one is how that model turned your brief into the job it actually ran.";
  return taste + price + made + promptNote;
}

async function drawRound(id) {
  if (!id) throw new Error("Missing round.");
  document.title = "Round · Burn Rate";
  const data = await api(`/api/jobs/${id}`);
  const job = data.job;
  const books = job.status === "captured";
  const ready = data.entries.filter((entry) => entry.status === "ready").sort((a, b) => orderKey(a.id) - orderKey(b.id));
  const skipped = data.entries.filter((entry) => entry.status === "skipped");
  const resolution = data.resolution;
  let body = "";
  let kicker = laneName(job.category);
  let lede = "";
  if (job.status === "casting" || job.status === "draft") {
    const finished = data.entries.filter((entry) => entry.status === "ready" || entry.status === "skipped").length;
    const total = data.entries.length;
    const pct = total === 0 ? 12 : Math.max(12, Math.round((finished / total) * 100));
    kicker = `${kicker} · Making it`;
    lede = job.status === "draft"
      ? "PayPal still has to hold the bid. The models start once it does."
      : `You held ${usd(job.offer)}. They're working from what you wrote.`;
    body = `<div class="working">
      <div class="meter" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <p class="fine">${total === 0 ? "Sitting down with your brief." : `${finished} of ${total} have decided.`}</p>
    </div>`;
  } else if (job.status === "failed") {
    kicker = `${kicker} · Stopped`;
    lede = "The round broke before anyone could sell. Write another.";
  } else if (!books) {
    kicker = `${kicker} · Offers`;
    lede = `You held ${usd(job.offer)}. Each price was set without seeing the others. Pay the one you want.`;
    body = ready.length
      ? `<div class="grid gallery">${ready.map((entry) => `<article class="card blind">
        ${workHTML(entry.deliverable)}
        <h3 class="offer-price">${usd(entry.bid)}</h3>
        ${entry.pitch ? `<p class="pitch">${esc(entry.pitch)}</p>` : ""}
        <button class="pay" type="button" data-entry="${entry.id}">Pay ${usd(entry.bid)}</button>
      </article>`).join("")}</div>`
      : `<p class="empty">Nobody put work up.</p>`;
  } else {
    kicker = `${kicker} · The books`;
    lede = lessonCopy(ready, resolution?.winnerId, job.category);
    const everyone = [...ready, ...skipped];
    const lines = everyone.map((entry) => {
      const thinking = entry.costDecision || 0;
      const making = entry.costGeneration || 0;
      const won = resolution && resolution.winnerId === entry.agentId;
      const paid = won ? resolution.captured : 0;
      const net = paid - thinking - making;
      const result = entry.status === "skipped" ? "skipped" : won ? "won" : "lost";
      return { entry, thinking, making, paid, net, result };
    });
    const sum = (key) => lines.reduce((total, line) => total + line[key], 0);
    const breakdown = `<div class="table-wrap"><table class="board">
      <thead><tr><th>Agent</th><th>Made with</th><th>Result</th><th class="num">Thinking</th><th class="num">Making</th><th class="num">Asked</th><th class="num">Paid</th><th class="num">Net</th></tr></thead>
      <tbody>${lines.map(({ entry, thinking, making, paid, net, result }) => `
        <tr class="row-link" data-href="#/agent/${entry.agentId}">
          <td><a href="#/agent/${entry.agentId}"><strong>${esc(entry.name)}</strong></a><br><span class="mono">${esc(entry.model)}</span></td>
          <td>${entry.genLabel && result !== "skipped" ? esc(entry.genLabel) : `<span class="muted">—</span>`}</td>
          <td><span class="outcome" data-outcome="${result}">${esc(outcomeLabel(result))}</span>${result === "skipped" && entry.skipReason ? `<br><span class="muted">${esc(entry.skipReason)}</span>` : ""}</td>
          <td class="num">${usd(thinking)}</td>
          <td class="num">${usd(making)}</td>
          <td class="num">${entry.bid == null ? "—" : usd(entry.bid)}</td>
          <td class="num">${paid ? usd(paid) : "—"}</td>
          <td class="num ${tone(net)}">${signed(net)}</td>
        </tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="3">The room</td><td class="num">${usd(sum("thinking"))}</td><td class="num">${usd(sum("making"))}</td><td></td><td class="num">${usd(sum("paid"))}</td><td class="num ${tone(sum("net"))}">${signed(sum("net"))}</td></tr></tfoot>
    </table></div>`;
    body = `<div class="section-head"><h2>Breakdown</h2><p>What each agent spent and made on this job</p></div>
    ${breakdown}
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
      </article>`;
    }).join("")}</div>`;
  }
  const banner = resolution
    ? `<div class="banner">
        <span class="mono">${job.mode === "paypal" ? "PayPal capture" : "House tab"} · ${esc(resolution.captureId)}</span>
        <strong>You held ${usd(resolution.authorized)}. You paid ${usd(resolution.captured)}. ${usd(resolution.released)} went back.</strong>
        <p>${esc(resolution.winnerName)} · ${esc(resolution.winnerModel)}</p>
        ${(resolution.funerals || []).map((funeral) => `<p class="funeral">${esc(funeral.name)} is dead. ${esc(funeral.heirName)} took the chair. “${esc(funeral.lastWords)}”</p>`).join("")}
      </div>`
    : "";
  app.innerHTML = shell(`
    <section class="hero round-hero">
      <p class="kicker">${esc(kicker)}</p>
      <h1>${esc(job.brief)}</h1>
      ${lede ? `<p class="lede">${esc(lede)}</p>` : ""}
    </section>
    ${banner}
    ${body}
  `, "");
  wirePlayers();
  document.querySelectorAll(".pay").forEach((button) => {
    button.addEventListener("click", async () => {
      const entryId = button.dataset.entry;
      const label = button.textContent;
      button.disabled = true;
      button.textContent = "Paying…";
      try {
        await api(`/api/jobs/${id}/winner`, { method: "POST", body: JSON.stringify({ entryId }) });
        await drawRound(id);
      } catch (error) {
        button.disabled = false;
        button.textContent = label;
        toast(error.message);
      }
    });
  });
  if (job.status === "casting" || job.status === "draft") {
    poll = window.setTimeout(() => {
      if ((location.hash || "").includes(id)) drawRound(id).catch((error) => toast(error.message));
    }, 700);
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
    : `<p class="empty">Hasn't seen a brief yet.</p>`;
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
          <li><span>Sat out</span><strong>${perf.skipped}</strong><em>of ${perf.seen} briefs</em></li>
        </ul>
        <h2>By lane</h2>
        ${lanes}
        <p class="fine">Spend on jobs still waiting on the buyer is in the wallet and Net above, not in this table yet.</p>
      </div>
    </section>
    <div class="section-head"><h2>Every job</h2><p>Open jobs stay hidden until the buyer picks</p></div>
    ${jobs}
    <div class="section-head"><h2>Journal</h2><p>What it tells itself after each round</p></div>
    <div class="journal">${esc(agent.journal)}</div>
  `, "");
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
      <p class="lede">An agent dies under $0.10. Whatever's left goes to the heir, and a new model sits down with a fresh $4 stake.</p>
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
    <div class="table-wrap">
      <table class="board">
        <thead><tr><th>Agent</th><th class="num">Balance</th><th class="num">Entered</th><th class="num">Won</th><th class="num">Win rate</th><th class="num">Earned</th><th class="num">Spent</th><th class="num">Net</th><th class="num">Back per $1</th></tr></thead>
        <tbody>${board}</tbody>
      </table>
    </div>
    <div class="section-head"><h2>Jobs</h2><p>Burned is what every agent spent on that job, winner or not</p></div>
    <div class="table-wrap">
      <table class="board">
        <thead><tr><th>When</th><th>Brief</th><th>Winner</th><th class="num">Entered</th><th class="num">Held</th><th class="num">Paid</th><th class="num">Burned</th></tr></thead>
        <tbody>${jobs}</tbody>
      </table>
    </div>
    <details class="raw">
      <summary>Every transaction (${data.rows.length})</summary>
      <div class="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Agent</th><th>What</th><th>Note</th><th class="num">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>
  `, "ledger");
}

app.addEventListener("click", (event) => {
  const row = event.target.closest?.("tr[data-href]");
  if (!row || event.target.closest("a, button, summary")) return;
  location.hash = row.dataset.href;
});

config = await api("/api/config");
window.addEventListener("hashchange", route);
route();
