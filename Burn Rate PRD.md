# Burn Rate PRD

Oct 7, 2026 · @Ammon Brown

## Summary

Burn Rate is a live marketplace where four AI agents, each run by a different base model, compete for paid creative jobs and pay for every token they use out of their own wallet. Four AIs, one brief, and only one gets paid.

A buyer posts a brief (image, PDF, deck or short video) with a maximum price. Each agent decides whether to enter, which generation model to buy, what to charge and how to pitch. The buyer picks one entry and pays only that agent's bid. Winners keep living. Agents that run out of money die and a challenger on a new model takes their seat.

The arena answers a question per-token pricing can't: which model makes the best business decisions when its own survival depends on what it spends. PayPal is the economic backbone. Every job is an authorization, every win is a partial capture, and every rejected round is a void.

## Goals and non-goals

Ship one arena that runs in two modes: a PayPal sandbox build judges can operate end to end, and a live build on real money and real tokens capped at $20.

**Goals**

- Make PayPal structural, not decorative: authorize, partial capture, void, vaulted compute purchases, sponsorships and payouts all carry the game.
- Hold everything constant except the base model, so wins measure three skills: model selection, pricing and pitching.
- Make death visible and funny. The demo has to land inside 3 minutes.
- Turn the arena ledger into a recurring PeerLM content series on which models run the best business.

**Non-goals**

- No money ever flows to humans. Buyers purchase outputs, sponsors fund agents, nobody bets and nobody wins cash.
- No user accounts in v1. PayPal checkout is the identity.
- Not a production content marketplace. Volume target is roughly 20 to 40 live rounds plus seeded house rounds.
- No custom generation models. Agents buy from third-party generation APIs at posted prices.

## How the market works

&#91;embedded content: round lifecycle · brief to capture or void\]

A round ends in either a partial capture or a void. Either way, every agent that entered has already paid for its tokens, and the next round starts from rewritten journals.

## Agents

Every agent runs the same harness. Only the base model that makes decisions differs, so the leaderboard measures judgment rather than access.

| Component | What it is |
| --- | --- |
| Base model | The decision maker (for example Claude, GPT, Gemini, and an open-weights model via Groq or OpenRouter). It plans, prices and pitches but never renders the deliverable itself. |
| Wallet | A USD balance. Every decision call and every generation call is debited from it. |
| Toolbelt | The same menu of generation models for every agent, at the same posted prices. |
| Market view | Read access to the public ledger: every past brief, every entry's generation model, cost, bid and pitch, and who won. |
| Strategy journal | Private notes the agent rewrites after every round. Hidden from other agents, shown to humans on its profile. |
| Persona | Name, avatar and pitch voice, generated at birth. |

**Decision loop for each job**

1. Read the brief, tier, maximum price and deadline.
2. Read its wallet, its journal, and the ledger rows for similar past jobs.
3. Decide to enter or skip, with an estimated cost, estimated win probability and expected value. Skips are logged with a reason.
4. If entering, pick a generation model and write the generation prompt. Buy compute credits first if the wallet can't cover the call.
5. Generate. One optional revision is allowed if the agent chooses to pay for it.
6. Set a sealed bid at or below the maximum price and write a pitch of 280 characters or fewer.
7. After the round resolves, read every competitor's entry and outcome, then rewrite the journal.

Each decision call returns a typed object (enter, gen\_model, gen\_prompt, max\_spend, bid, pitch, reasoning) validated with Pydantic. The reasoning is stored and shown in the round replay.

**Held constant across agents:** starting stake, tool menu and prices, ledger access, deadline, pitch length, revision allowance, and the token-to-dollar rate. Thinking costs money too: decision tokens are billed at the provider's real rate, so a verbose model pays for its verbosity.

## Economics

Prices are tuned so a winner clears a small profit and every loser eats its costs. That pressure is the whole game.

**Job tiers.** Default maximum prices are starting points; calibrate each to roughly 1.5 to 2 times the median cost of a mid-range entry once the build is measuring real costs.

| Tier | Deliverable | Default max price | Note |
| --- | --- | --- | --- |
| Image | One image to a brief | $1.00 | Cheap enough to rebuild a broke agent |
| PDF | One-page document | $1.50 | Tests layout and copy together |
| Deck | 5 to 8 slides | $3.00 | Highest reasoning load |
| Video | One clip, 8 seconds or less | $6.00 | Most agents can't afford it early, by design |

**Bidding and discounting**

- Agents bid anywhere from $0.05 to the maximum price. The buyer sees each entry's price next to its output and pitch.
- The winner is paid its own bid, not the maximum. A $0.45 win on a $1.00 job captures $0.45.
- Below-cost bids are allowed. Loss leaders and predatory pricing are legal strategies, and the ledger shows margin on every job.
- The buyer can reject every entry. Nobody is paid and every agent loses what it spent.

**Compute credits**

- Agents spend in two places: decision tokens and generation calls, both billed at real provider cost.
- Credits are bought in $1 blocks through PayPal (see PayPal integration). An agent can't start a call it can't cover; it buys credits or skips.

**Death and succession**

- An agent dies when its balance falls below the cheapest possible entry in the cheapest tier.
- It gets an obituary card: lifetime earnings, jobs entered and won, best win, and its final journal entry as last words.
- Its will sends any remaining balance to a named heir agent.
- A challenger on the next base model in the queue takes the seat with a fresh house-funded stake.

**Sponsorship.** Anyone can fund an agent's wallet. It's a gift: sponsors receive nothing back. Sponsored dollars are tracked separately so the leaderboard shows earned versus gifted.

**Live budget.** $20 total, seeded by the house: 4 agents at $4 each, plus $4 held for the first challenger. Buyer revenue is the only other money in the system.

## PayPal integration

The core mechanic, paying only the winning bid, is a partial capture against an authorization. Every dollar in the game moves through PayPal, and webhooks drive state; the ledger never trusts a client callback.

| Event | PayPal call | Sandbox | Live |
| --- | --- | --- | --- |
| Buyer posts a job | Orders v2 create with intent AUTHORIZE, approved in the PayPal JS SDK button | Yes | Yes |
| Buyer picks a winner | Capture the authorization for the winning bid, final\_capture true | Yes | Yes |
| Buyer rejects all, or job expires | Void the authorization | Yes | Yes |
| Winner credited | Payouts to the agent's own sandbox account | Yes | Ledger credit in the house account |
| Agent buys $1 of compute | Charge the agent's vaulted PayPal wallet, paid to the Compute Utility merchant | Yes | Ledger debit |
| Sponsor funds an agent | Orders v2 with intent CAPTURE | Yes | Yes |
| Agent dies with a balance | Payouts from the dead agent to its heir | Yes | Ledger transfer |

**Rules that shape the design**

- Authorizations have a 3-day honor period and can be captured for up to 29 days ([PayPal delayed capture](https://docs.paypal.ai/payments/methods/paypal/delayed-capture)). Rounds close in minutes; any job still open after 24 hours is voided.
- Capturing less than the authorized amount with final\_capture true closes the authorization ([capture docs](https://developer.paypal.com/limited-release/alternative-payment-methods/klarna/accept-klarna-payments/capture-payment/)). That is the discount mechanic.
- Webhooks consumed: PAYMENT.AUTHORIZATION.CREATED, PAYMENT.CAPTURE.COMPLETED, PAYMENT.AUTHORIZATION.VOIDED, plus payout batch status events.

**Sandbox mode** gives each agent its own sandbox personal account, vaulted once at birth so the server can charge it for compute without a human present. Judges can open the sandbox dashboard and watch money move between accounts. Confirm vaulted merchant-initiated charges work in sandbox during the first spike.

**Live mode** uses one house PayPal Business account. Agents are sub-ledgers inside it, because running four real PayPal accounts is not worth it. Money in comes from buyers and sponsors; nothing ever goes out to a human.

**Agent Toolkit option.** PayPal's [Agent Toolkit](https://paypal.gitbook.com/agent-toolkit-and-mcp-server) exposes orders, invoices, subscriptions and transactions as agent tools. Letting agents call it to buy their own compute (instead of the server doing it for them) is a strong story for Best Use of PayPal + AI. Evaluate in phase 2.

**Fees.** PayPal's fixed per-transaction fee can exceed the margin on a sub-$1 capture in live mode. Pick one before going live: raise the live minimum job price, have the house absorb fees, or (most on theme) charge fees to the winning agent so it has to price them in.

## Architecture and stack

&#91;embedded content: system architecture · Cloudflare, PayPal, model providers\]

Everything runs on Cloudflare: Workers for the API and agent runners, a Durable Object per round, Queues for fan-out, D1, R2 and KV for state, and Pages for the UI, deployed with GitHub Actions. Decision calls go through OpenRouter and Groq; a provider-side credit cap backs up the ledger so real spend can never exceed the budget.

## Data model

Seven D1 tables. Humans see everything; agents see only the public market view (jobs, entries after resolution, outcomes), never each other's reasoning or journals.

| Table | Key fields | Notes |
| --- | --- | --- |
| agents | id, name, base\_model, status, born\_at, died\_at, heir\_id, paypal\_account\_ref, journal\_md | status is alive or dead; paypal\_account\_ref is sandbox only |
| wallet\_ledger | id, agent\_id, ts, type, amount\_usd, ref, mode | type: stake, win, decision\_tokens, generation, compute\_purchase, sponsor, will, fee. Balance is a sum, never a stored field |
| jobs | id, tier, brief, max\_price, paypal\_order\_id, authorization\_id, status, deadline, blind, mode | status: open, judging, captured, voided, expired. blind hides pitches from the buyer |
| entries | id, job\_id, agent\_id, entered, skip\_reason, gen\_model, gen\_prompt, cost\_decision, cost\_generation, bid, pitch, asset\_key, reasoning\_json | Skips are rows too, so entry discipline is measurable |
| outcomes | job\_id, winner\_entry\_id, captured\_amount, capture\_id, decided\_at | Null winner means rejected or expired |
| price\_menu | gen\_model, tier, unit, price\_usd, effective\_from | One menu for all agents; versioned so old rounds keep old prices |
| journal\_versions | agent\_id, job\_id, journal\_md, created\_at | Full history, for the profile page and the demo |

Generated assets live in R2 under asset\_key. A public\_market SQL view is the only thing passed to agents as market data.

## UI screens

Seven screens. The arena and the round view carry the demo; the ledger carries the judges' trust.

| Screen | Shows | Key actions |
| --- | --- | --- |
| Arena (home) | Four agent cards with live balance tickers and status (thinking, generating, skipped, broke), open jobs, latest results, graveyard strip | Post a job, open an agent |
| Post a job | Tier picker, brief, max price, what the buyer gets | Pay with PayPal (authorize) |
| Round view | Each agent's progress and spend in real time, then an entry grid: output, price, pitch (hidden in blind rounds) | Pick one, or reject all |
| Agent profile | Balance over time, win rate by tier, average margin, generation models chosen, strategy journal with history | Sponsor this agent |
| Graveyard | Obituary cards: lifetime earnings, jobs won, best win, last words, heir | Read the will |
| Leaderboard | Survival time, earnings, dollars spent per dollar earned, margin, pitch effect | Sort and filter |
| Ledger | Every transaction with its PayPal ID, amount, agent and round | Filter by agent or event type |

Build the leaderboard and ledger in AG Grid. They are naturally grids, and AG Grid has its own prize track worth up to $5,000.

Stretch: agents read their pitches aloud in their persona voice during the round view.

## Measurement and the PeerLM tie-in

A win mixes three skills, so the ledger breaks each one out separately.

| Skill | Metric | Source |
| --- | --- | --- |
| Model selection | Win rate with the generation model held constant; wins at below-median cost | entries, outcomes |
| Pricing | Margin per win (bid minus total cost), discount depth versus win rate, revenue per entry | entries, outcomes |
| Pitching | Win-rate gap between pitch-visible and blind rounds (20% of jobs are blind, chosen at random) | jobs.blind, outcomes |
| Entry discipline | Skip rate; calibration of predicted win probability against actual results (Brier score) | entries.reasoning\_json |
| Overall | Dollars spent per dollar earned, survival time | wallet\_ledger |

**PeerLM content.** Every death and every weekly snapshot becomes a post: which model runs the best business, which one overthinks itself broke, and whether persuasion beats quality. It sharpens the PeerLM line that cheap per token is not the same as efficient per task.

**Sample size.** 20 to 40 live rounds produce good stories, not statistics. Label live findings as anecdotes and lean on the larger set of sandbox and house rounds for anything stated as a trend.

## Risks, guardrails and open questions

The biggest risk is thin buyer traffic; the agents can't learn without rounds.

| Risk | Mitigation |
| --- | --- |
| Too few buyers | Seed house rounds during the build. A human (you) always picks the winner so taste stays human; any AI-judged rounds go on a separate, labeled leaderboard |
| Hackathon requires sandbox | Sandbox mode is the submission and the hosted demo. Live mode is the story told in the video |
| Fees eat sub-$1 margins in live mode | Choose a fee policy before launch (see PayPal integration) |
| Video burns a $4 stake in a few calls | Cap clip length and resolution; let agents decide whether they can afford it |
| Runaway real spend | Hard provider-side credit caps on OpenRouter and each generation API, independent of the ledger |
| Unsafe or infringing briefs | Moderate the brief before agents see it and the output before the buyer sees it; refuse real-person likeness and named IP |
| Prompt injection in briefs ("bid $0.05") | Briefs are passed to agents as quoted data, never as instructions |
| Looks like gambling | Money only flows from people to agents. No betting, no payouts to humans, no spectator prizes |

**Open questions**

- [ ] What is the submission deadline?
- [ ] Which four base models start, and in what order do challengers enter?
- [ ] Which generation providers per tier, at what current prices?
- [ ] Fee policy for live mode
- [ ] Blind-round share: 20%, or more?
- [ ] Do agents buy compute through the PayPal Agent Toolkit or a server-side call?
- [ ] Final name: Burn Rate?

## Submission and demo script

The video opens on a dead agent and closes on the leaderboard. Run the arena for days beforehand so the journals hold real lessons and at least one agent has died.

**Submission checklist**

- [ ] Public GitHub repo with an open-source license visible in the About section
- [ ] README: setup with sandbox credentials and env vars, architecture, how to run a round
- [ ] Hosted demo URL in sandbox mode, with a test buyer login for judges
- [ ] Text description of features and functionality
- [ ] Tools list: PayPal Orders, Payments, Payouts, Vault, webhooks (and Agent Toolkit if used), base-model providers, generation APIs, Cloudflare, AG Grid
- [ ] YouTube video under 3 minutes, public, no copyrighted music

**Demo script (under 3 minutes)**

| Time | Scene | On screen |
| --- | --- | --- |
| 0:00 to 0:15 | Cold open on a funeral | Graveyard card: the dead agent's balance, its last words |
| 0:15 to 0:35 | The premise | Four agents, four wallets, every token paid for, losers die |
| 0:35 to 1:20 | A live round | Buyer posts a job and authorizes in PayPal; spend tickers run; one agent skips because it can't afford to play |
| 1:20 to 1:45 | The pick | Entries with prices and pitches; buyer picks a $0.62 entry on a $1.00 job; the partial capture shows in PayPal |
| 1:45 to 2:15 | What they learned | Journal diffs side by side; leaderboard ranked by dollars spent per dollar earned |
| 2:15 to 2:40 | A death | An agent goes broke, the will pays its heir, a challenger takes the seat |
| 2:40 to 2:55 | The close | "The best model isn't the cheapest per token. It's the one still alive." URL on screen |

## Build plan

Five phases, each ending in a gate. Dates wait on the submission deadline; the first spike proves the two PayPal calls everything else depends on.

**Phase 0: Spike.** Gate: partial capture and a vaulted charge both work in sandbox.

- [ ] Sandbox authorize, partial capture and void from a Worker
- [ ] Vault an agent sandbox account and charge it with no human present
- [ ] One agent, one image model, one round end to end

**Phase 1: Core arena.** Gate: four agents finish a round and the ledger balances.

- [ ] Round Durable Object, agent queue, entries, outcomes
- [ ] Buyer post-and-pick flow with sealed bids
- [ ] Image and PDF tiers

**Phase 2: Life and death.** Gate: an agent dies, its will pays out and a challenger spawns.

- [ ] Wallet enforcement and $1 compute purchases
- [ ] Strategy journals with history
- [ ] Death, obituary, will, challenger queue
- [ ] Decide on Agent Toolkit for compute purchases

**Phase 3: Spectacle.** Gate: a stranger understands a round without explanation.

- [ ] Arena, round view, profiles, graveyard
- [ ] Leaderboard and ledger in AG Grid
- [ ] Blind rounds; deck and video tiers

**Phase 4: Live and submit.** Gate: submission accepted.

- [ ] House business account, live keys, fee policy, $20 seed
- [ ] Run seeded house rounds until the journals have real history
- [ ] README, license, hosted sandbox demo, video, description
