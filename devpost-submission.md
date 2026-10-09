# Burn Rate

Draft updated October 9, 2026 after reviewing the current source, hosted app/API, original PRD, saved hackathon requirements, and existing form questions. **Save only; do not submit. YouTube is deferred at the user's request.**

The Devpost connector returned internal errors for account, project, registration, requirements, criteria, and dates. This is a provisional readiness review using the original requirements in `hackathon-info.md`; it does not certify a fresh official rules check. No rules acknowledgment is recorded locally. The current description below targets the current source, whose hosted sign-in and generation are not yet enabled. Keep the verification notes with this draft until those gaps are resolved.

## One-line Summary

Four AI agents spend their bankrolls competing for your creative brief. You compare the work and prices; PayPal captures only the winning offer.

## Project Story — About the project

Public description draft. Review the current-source/live gaps in **Submission Readiness Notes** before publishing.

### Inspiration

AI can make a thing. What happens when it has to decide what that thing is worth?

Making good work is only part of running a creative business. You also have to choose your tools, control costs, price the result, and persuade someone to buy it. Burn Rate puts those decisions in the hands of AI agents, gives them small bankrolls, and lets a human decide who earns the next paycheck.

Four agents get the same brief. They can spend more for a better result, make something cheap and undercut the room, or sit out. Thinking costs money too. Only one gets paid; everybody who entered keeps their costs.

### What it does

Describe a project and set a ceiling from $0.50 to $5. Sign in by email, then approve a PayPal Sandbox authorization for that ceiling. The agents independently choose what to make, which generation model to hire, what price to ask, and how to pitch it. Their offers stay sealed from one another.

Compare the completed work, prices, and pitches with agent identities hidden. Choose one winner. Burn Rate captures that agent's asking price with PayPal and closes the remaining authorization. There is no reject-all option in this prototype.

Then the books open: who made each offer, the prompts, the generation models, and the recorded thinking and making costs. The winner earns its sale in an application wallet. An agent below $0.10 after settlement leaves the room, gets an obituary, and passes its remaining balance to a challenger with a fresh stake.

There are five formats: images, short video clips, memos or decks, logos, and comedy bits. Public rounds, agent profiles, journals, and the ledger let you follow the contest. The ledger is a set of sortable, filterable grids: who is solvent, what each job burned, and every stake, thinking call, generation, win, and will, with search and CSV export. Each agent page charts its bankroll falling toward or climbing away from the retirement line. Simulated checkout is available as a separate test path and is labeled accordingly. All buyer payments use sandbox test funds; agent wallets do not cash out to people.

### Why it matters

For creators and small businesses, the idea is simple: compare the work and the price together. For developers exploring agentic commerce, the experiment makes choices about spending, pricing, and survival visible.

A cheaper model can still make an expensive business decision. A beautiful result can still lose money. Burn Rate gives those tradeoffs a visible consequence. It is an early experiment, with no claim of validated demand, measured savings, or a statistically meaningful model ranking.

### How we built it

The application uses a TypeScript/Hono API on Cloudflare Workers, D1 for accounts and round accounting, R2 for generated media, and Cloudflare Workflows for orchestration and video polling. The interface is JavaScript, HTML, and CSS. The Ledger and agent pages use AG Grid Community for the agent leaderboard, job list, per-agent job history, lane breakdown, and every wallet transaction. AG Charts Community plots each agent's bankroll over time against the $0.10 retirement line. Cloudflare Email Service supports expiring, single-use sign-in links, with account ownership and shared generation allowances enforced on the server.

Each agent has a separately configured decision model through OpenRouter. The starting seats are Ada Ledger (Claude Opus 5.5), Rex Close (GPT-5.5), Nia Cut (Gemini 3.1 Pro), and Jules Static (DeepSeek V4 Pro). They receive their own journal and settled results alongside the same brief and generation menu. The decision model chooses a hired model for the actual creative work. The menu includes text, image, logo, and short-video options; an agent can skip when its wallet cannot cover the estimated making cost.

The ledger uses OpenRouter's reported `usage.cost` when available. Missing cost data falls back to an estimate, so the game ledger is not an audited provider invoice. Historical demo rounds from the earlier Workers AI build used one Llama text backend and FLUX images; they are not results from the new four-model configuration.

PayPal is central to the transaction. The JavaScript SDK collects approval, Orders v2 creates and authorizes the budget ceiling, and Payments v2 captures only the selected offer with `final_capture: true`. This separates permission to spend from the final price, which is unknown until the buyer chooses. PayPal request IDs remain stable across retries. The server makes those calls through the APIMatic-generated PayPal Server SDK for TypeScript, installed with APIMatic's PayPal Context Plugin, which handles OAuth token caching and returns typed PayPal error bodies.

Codex helped implement and review the API, payment flow, public pages, access and ownership controls, spending limits, email sign-in, tests, and deployment work. AI creative decisions and generation run through the application's model integrations.

### Challenges and what we learned

The payment and creative timelines are different. A buyer commits a maximum before the agents work, but the purchase price only exists after comparison. That made authorization followed by a final partial capture a natural fit.

We also had to distinguish a sandbox payment from the real cost of running AI. Account access alone does not contain inference spending. Both PayPal and simulated rounds reserve the same atomic daily and lifetime allowances before work starts, and the app can pause generation while completed rounds remain readable.

Failure is part of the product. A model can decline a job, fail to return a plan, or choose a renderer that fails. The round records skipped offers; if no offer succeeds, a deterministic house fallback keeps the interface usable without another AI call. That fallback must not be mistaken for successful model generation.

### Accomplishments we're proud of

The core experience ties creative work, price, payment, and consequences together. A buyer sees the offers before choosing; the receipt opens the cost ledger afterward. Agent outcomes feed into later decisions, and an agent's bankroll can end its run.

The earlier hosted build produced working memo and image rounds, including four generated FLUX images. The current source also passes seventeen local security/integration tests, including a mocked PayPal authorization and final partial-capture lifecycle. Hosted buyer approval, capture, email delivery, and the latest model paths still need end-to-end verification.

### What's next

Finish hosted email and OpenRouter configuration, verify the latest models and PayPal Sandbox buyer flow, and make the public explanation agree with the running build. Next product work includes payment reconciliation, cancellation and refunds, clearer cost provenance, and a wider set of real creative rounds. Those rounds can inform the experiment; they will not establish a model benchmark on their own.

## Built with

PayPal, PayPal JavaScript SDK, PayPal Orders API, PayPal Payments API, APIMatic PayPal Server SDK, APIMatic Context Plugins, OpenRouter, Cloudflare Workers, Cloudflare Workflows, Cloudflare D1, Cloudflare R2, Cloudflare Email Service, AG Grid, AG Charts, Hono, TypeScript, JavaScript, HTML, CSS, Wrangler, Codex.

The current configured model catalog is in `src/catalog.ts`. Do not add every offered model to the tools list as though each has been exercised. The sponsor integrations are AG Grid Community 36.2 with AG Charts Community 14.2, both MIT-licensed and served from `public/vendor/`, and APIMatic's MIT-licensed PayPal Server SDK 2.29 (`paypal`, pinned to a commit of `context-plugins/paypal-typescript-sdk`) behind `src/paypal.ts`.

## Try it out links

- Hosted app: https://burnrating.com
- Completed image round: https://burnrating.com/#/round/09e28300-04e7-440b-b84d-73d417565e9e
- Completed memo round: https://burnrating.com/#/round/6424b3e4-ccd3-4172-bc07-995d8a87880f
- Source: https://github.com/ammbo/burn-rate — **GitHub reports PRIVATE; public visibility is required before final submission under the saved requirements.**

The old burnrateagents.com URL redirects to burnrating.com. The two linked rounds are historical Workers AI rounds with simulated payment, not proof of the latest OpenRouter models or PayPal settlement.

## Additional info — answers for judges and organizers

### Upload a File

Optional in the pasted form. No attachment is prepared or claimed. If adding one, use only relevant supporting materials and stay under the pasted 35 MB limit. Do not include `.dev.vars`, `.launch-access.json`, or private credentials.

### Submitter Type

**Operator to choose:** Individual / Team / Organization. Do not infer legal submission status from the app's operator name.

### Submitter Country of Residence

**Operator to supply:** actual country of residence for the submitter.

### Canadian province

**Copy if no team member resides in Canada:** N/A

Otherwise enter the actual province(s).

### Organization Name

**Copy if not representing an organization:** N/A

Otherwise enter the organization you represent. The product name alone does not establish this answer.

### New or existing before October 1, 2026, 9:15 am PT?

**Suggested answer, subject to operator confirmation: New.** The available Git history begins October 7, 2026. Git history does not prove when work outside the repository began.

### What existed before the submission period?

**Copy if New is accurate:** N/A — this is a new project.

If it existed earlier, replace this with a truthful description of the earlier work and the changes made during the event. Also add that disclosure to the story.

### Explain how your project meets the main technology requirement

Burn Rate combines PayPal Sandbox checkout with AI agents that make creative and economic decisions. The PayPal JavaScript SDK collects buyer approval. The server uses Orders API v2 to create an order with `intent: AUTHORIZE` for the buyer's maximum budget and authorize it after approval. After the buyer selects an offer, Payments API v2 captures that offer's price with `final_capture: true`. Order, authorization, and capture references are stored with the round in Cloudflare D1. Stable PayPal request IDs support retries. The server calls go through the APIMatic-generated PayPal Server SDK for TypeScript. Agent wallets are application ledger balances; this build does not use PayPal Payouts, Vault, subscriptions, sponsorship payments, or webhooks.

In the current source, OpenRouter supplies the AI calls. Four separately configured decision models receive the same brief, budget, generation menu, their own bankroll and journal, and recent settled outcomes. Each decides whether to enter, which model to hire, the generation prompt, its price, and its pitch. Starting seats are configured for Claude Opus 5.5, GPT-5.5, Gemini 3.1 Pro, and DeepSeek V4 Pro. Hired models produce text, images, logos, and short video through OpenRouter's chat, image, and video APIs. Cloudflare Workflows coordinates the round and video polling; R2 stores generated media. The ledger records provider-reported `usage.cost` where available and estimates when it is absent.

Verification boundary: the previous hosted version completed Workers AI Llama/FLUX rounds with simulated checkout. The latest distinct-model OpenRouter paths and real PayPal buyer approval/final partial capture still require end-to-end verification. The current hosted configuration reports sign-in and generation disabled. Do not describe the older rounds as proof that the latest models ran.

### Which additional sponsor tools did you use?

**Copy:** AG Grid, APIMatic.

AG Grid Community and AG Charts Community power the Ledger and agent pages. APIMatic's PayPal Context Plugin supplied the generated PayPal Server SDK and the agent skills used to integrate it; the SDK makes every server-side PayPal call. No Astropods, Bryntum, Channel3, Elastic, KERNEL, Postman, Render, or Zapier integration is present.

### Public code repository URL

https://github.com/ammbo/burn-rate

**Required before submission:** make the repository public after reviewing the final source and history; push any later changes before sending. It contains an MIT license and setup/integration instructions. On October 9 the local HEAD matched origin/main; GitHub still reported PRIVATE visibility. Publishing remains a separate operator decision.

### Working demo URL

https://burnrating.com

### Testing instructions or credentials

**Current status:** https://burnrating.com is available for browsing completed rounds. On October 9 its API reported `paypalMode: sandbox`, `signInEnabled: false`, and `generationEnabled: false`. Judges cannot yet complete a new hosted round. The instructions below are the intended test path after configuration and verification; remove this warning only after a real hosted walkthrough succeeds.

Copy the following into the private judge field once verified:

> Open https://burnrating.com in a desktop browser with JavaScript enabled. Choose a format, describe the project in 12–400 characters, and set a maximum budget between $0.50 and $5. Click Continue, enter an email address you control, and open the emailed link in the same browser profile. Click Sign in, then return to the saved project. Sign-in alone does not start generation or create a payment order.
>
> For the PayPal integration, choose the PayPal Sandbox checkout and approve with a Sandbox Personal buyer account separate from the merchant. Use test credentials, not a real PayPal login. Wait for the offers, compare the work, prices, and pitches, then choose one winner. The receipt reveals the agent identities, generation prompts, and thinking/making costs. Check the PayPal authorization and final partial capture against the receipt: only the chosen offer should be captured.
>
> “Start with simulated checkout” exercises the creative round and game ledger without a real PayPal API authorization or capture. It also requires sign-in and consumes the same generation allowance. Public completed rounds, agent profiles, and the ledger can be explored without signing in.
>
> Limits are three requests per account per UTC day, six per IP, twenty across the app per UTC day, fifty total, and a shared thirty-second cooldown. Failed and abandoned requests count. Contact the submitter if judging allowance is exhausted; a new session does not reset it. Projects and outputs are public, so omit confidential information.

**Private credentials still needed:** a dedicated PayPal Sandbox Personal buyer login, supplied only in the judge field after verification. No password or invite code belongs in this public draft, repository, screenshots, or video. The old invite-code instructions no longer match the current source's new-round flow.

Local setup and verification commands are in the README. Configure your own Cloudflare resources, OpenRouter key, authentication secret, email sender, and PayPal Sandbox REST app. Local email delivery is simulated. The hosted configuration must be completed for judges to use the browser test path above.

### Overall PayPal integration rating

**Operator to choose:** a score from 1–10 based on your own experience. No rating is fabricated here.

### PayPal feedback — editable draft

The authorize-then-capture flow fits this project well: the buyer can set a ceiling before the agents work, then pay only the winning offer after comparison. The JavaScript SDK handles buyer approval while the server uses Orders v2 and Payments v2 for the actual authorization and final partial capture. The main engineering challenge is coordinating payment state with the app's job state and designing recovery for retries and partial failures. This submission stays in Sandbox while those production recovery paths are developed.

### Open to follow-up contact?

**Operator to choose:** Yes / No.

### APIMatic Context Plugin experience

> If you used the APIMatic Context Plugin during your integration, briefly share your experience — what worked well, any issues you encountered, and how it compared to building without it.

**Copy (editable draft):**

We installed the PayPal Context Plugin into Cursor (`npx context-plugins install paypal`) and used it to move Burn Rate's server-side create-order, authorize, and final partial-capture calls from hand-written `fetch` requests to the APIMatic-generated PayPal Server SDK for TypeScript.

**What worked well:** the SDK map inside the package gave the coding agent exact field names, headers, and error arms to look up instead of guess. The SDK caches the OAuth token and returns typed PayPal error bodies, so buyers see PayPal's own reason and our logs keep the `debug_id`. It uses only standard `fetch`, so it ran on Cloudflare Workers unchanged.

**Issues:** the plugin's skill text named the package `pay-pal-server-sdk`, but the repository publishes it as `paypal`. The SDK installs from GitHub rather than npm. It declares only a Sandbox environment, so live mode needs a base-URL override. Its schema-checked token response also meant our test fixture needed `token_type`.

**Compared to building without it:** our first attempt used the npm `@paypal/paypal-server-sdk`, whose axios transport failed on Workers ("Unsupported cache mode") until we added an `unstable_` workaround. The plugin's SDK needed no workaround, and the migration took less guesswork than our original hand-written `fetch` calls.

### AG Grid experience

**Copy (editable draft):**

Burn Rate is a survival game for AI agents, so the ledger is the scoreboard. We used AG Grid Community for every table on the Ledger and agent pages and AG Charts Community for each agent's bankroll history. We did not use AG Studio.

- **Agent leaderboard:** balance, entries, wins, win rate, earnings, spend, net, and return per dollar. Columns sort and filter, net is colored by sign, retired agents are dimmed, the agent column stays pinned when scrolling sideways, and clicking a row (or pressing Enter) opens that agent.
- **Jobs grid:** floating filters on every column (format, payment mode, winner, brief, amounts) and a pinned total row. The total recomputes from `forEachNodeAfterFilter` on every filter change, so filtering to "Video clip" or one winner shows what those jobs held, paid, and burned.
- **Every transaction:** the latest 200 wallet entries (stakes, thinking calls, generations, wins, wills) with quick search, per-column filters, pagination, and CSV export of raw timestamps and amounts, including hidden model and job ID columns.
- **Agent pages:** the lane breakdown and the agent's full job history are grids, and an AG Charts step line shows the bankroll after every ledger entry, with a dashed cross line at the $0.10 retirement threshold.

One theme built with `themeQuartz.withPart(colorSchemeDark).withParams(...)` matches the site's ember, ink, and gold palette and its fonts, so the grids read as part of the app. The UMD bundles are vendored, load only when a Ledger or agent page opens, and are destroyed on navigation. If they fail to load, the plain HTML tables rendered first stay in place.

What worked well: column types, value getters, and formatters let one set of money and count column helpers serve five grids, and the theming API needed no CSS overrides beyond cell layout. One snag was that a custom `cellClass` replaces the class from `type: "rightAligned"`, so we added our own right-aligned numeric cell class. Another was that a pinned row's cell renderer refreshes only when its value changes, so the filtered-total label has to live in a field.

### Eligibility declarations

**Operator must personally confirm** all applicable statements before checking them:

- All team members have reached the age of majority where they reside.
- All team members are from eligible jurisdictions.
- No team member is an employee, representative, or agent of an excluded Promotion Entity.

No eligibility declaration or terms acknowledgment has been made by this document.

## Demo Video

**Deferred at the user's request. No URL is set or claimed.** The original saved requirements call for a publicly visible YouTube video under three minutes. Confirm the live requirement before final submission. Do not use the old draft's public-or-unlisted wording as approval of unlisted visibility.

Retained 2:45 recording outline for later:

1. 0:00–0:20 — “Four agents can make the work. Only one can make the sale.” Show the project brief and maximum budget.
2. 0:20–0:50 — Show verified PayPal Sandbox approval using a dedicated buyer. Keep credentials and private email out of the recording.
3. 0:50–1:25 — Show the agents' progress and completed offers. If a render takes minutes, make the time cut visible. Compare outputs, prices, and pitches.
4. 1:25–1:55 — Choose one offer; show its receipt and the matching final partial capture in PayPal. Use amounts from the actual recorded round.
5. 1:55–2:25 — Open the models, prompts, thinking/making costs, and journal. Explain provider-reported costs versus estimates, and keep simulated historical rounds labeled.
6. 2:25–2:45 — Show a real death/challenger only if one has occurred. Otherwise close on the ledger and the URL. Do not fabricate one for the video.

## Screenshot Shot List

Capture from the final running build after verification:

- Arena with four competitors and the project form.
- Verified PayPal Sandbox approval, with credentials and personal details hidden.
- Completed gallery with work, prices, and pitches before identity reveal.
- Winner receipt, revealed prompts/models, and cost breakdown.
- Agent history or ledger; use a graveyard view only if a real retirement has occurred.
- For the AG Grid track: the Ledger grids with a jobs filter applied (showing the filtered total row), the transaction search and CSV export, and an agent page's bankroll chart. Local reference captures from October 9 are in `output/ag-grid-ledger-top.jpg`, `output/ag-grid-agent.jpg`, and `output/ag-chart-agent.jpg`.

Existing local files include `output/auth/project-sign-in.png` and older marketing/live screenshots. The sign-in image is a local simulator walkthrough, and older assets predate the latest runtime. They are reference material, not proof of current hosted end-to-end operation. No fabricated screenshots, deaths, or metrics are included.

## Submission Readiness Notes

**Result: not ready for final send-out. Save-only draft.**

Observed October 9:

- Hosted https://burnrating.com is reachable. Its API reports PayPal configured in Sandbox, `signInEnabled: false`, and `generationEnabled: false`. Public browsing works; a new hosted round is blocked. This supersedes the older draft's invite-code judge instructions and the older deployment notes for current availability.
- The public arena still contains two completed historical rounds and an empty graveyard. The current entry responses use new agent model labels, while saved winner resolutions retain the earlier labels. Do not attribute the historical outcomes to the newly configured models.
- Current source routes calls through OpenRouter and includes email accounts, Workflows, R2, and generated-video handling. Live provider compatibility, rendering, delivery, and settlement have not been established by this review. The scraped public homepage still describes one shared text model and game prices; that copy must be reconciled with the final runtime and ledger policy.
- AG Grid and AG Charts were added on October 9 and verified on a local dev server: all five grids and the bankroll chart render, and filtering, the filtered total row, quick search, CSV export, and row navigation work. **They are not deployed yet**; https://burnrating.com still shows the plain tables until the next `npm run deploy`. The repository must also be pushed before the public code link reflects them.
- The APIMatic PayPal Server SDK replaced the hand-written PayPal calls on October 9. From a local Worker, sandbox order creation succeeded, and authorize-before-approval, capture of an unknown authorization, and a wrong client secret each returned PayPal's reason. A buyer-approved authorize and final partial capture through the SDK has **not** been run yet; do that before claiming it. Not deployed yet.
- `npm run check` passed. All 17 `npm run test:security` tests passed with local D1 and mocked OpenRouter/email/PayPal. All 8 public tests passed against https://burnrating.com. Passing HTTP and mock checks do not establish real email, inference, or PayPal settlement.
- GitHub reports the MIT-licensed repository as PRIVATE. Local HEAD and origin/main matched at `3facdbeecdbb8de1fc588144107926d29fd94a4c`. Source is pushed; public visibility remains a separate decision.
- A tracked-file secret scan found only mock credentials in the security tests. `.dev.vars` and `.launch-access.json` exist locally and are ignored/untracked. No credential values were copied into this packet. Review repository history before making it public.
- The Devpost MCP account/project/requirements/criteria/date calls failed with internal errors. Fresh official requirements, registration, project state, and final submission status could not be verified through the connector. The browser fallback showed only the existing Four Word Pass entry. Creating a separate project opened draft record `1227205`, but its overview editor remained blank through reload. Burn Rate copy was not saved remotely, and the existing project was not edited. Resume at https://devpost.com/submit-to/31302-paypal-ai-hackathon/manage/submissions/1227205/project-overview when Devpost recovers. No final send was attempted.

Required before a final send, based on the original saved requirements:

- [ ] Enable and verify hosted email sign-in, then a fresh OpenRouter round with the final model configuration. Make public copy and cost labels agree with the recorded behavior.
- [ ] Complete PayPal Sandbox buyer approval, authorization, winner selection, and final partial capture; compare the receipt with PayPal records. Supply a dedicated buyer login privately to judges.
- [ ] Publish the reviewed MIT-licensed source repository with complete setup instructions and the exact source used for the demo.
- [ ] Finish submitter type, country, Canadian province if applicable, organization if applicable, new/existing disclosure, integration rating, feedback/contact preference, and personal eligibility declarations.
- [ ] Record the YouTube demo when requested. It is intentionally deferred for this save-only pass.
- [ ] Recheck the live event requirements and rules, then obtain the user's explicit final-send instruction. Do not submit during this pass.

## Known Limitations

The current hosted build cannot start new rounds. Latest configured model/video integrations and real email delivery remain unverified end to end. Cost data can be estimated; provider failures and retries prevent treating the application ledger as an exact invoice. A deterministic fallback can substitute when every offer fails. Historical rounds use the earlier shared-model implementation. Journals append recorded outcomes; there is no demonstrated self-training or model-weight update. Model/provider/persona differences confound benchmark claims. Projects and outputs are public. There is no reject-all option, comprehensive moderation, cancellation/refund UI, or production payment reconciliation. PayPal remains in Sandbox. Agent wallets are game accounting, with no separate PayPal account, compute purchase, sponsorship, or payout per agent.

## TODO Official Form Fields

Personal and legal answers remain with the operator in the **Additional info** section above. No legal declarations or official rules acknowledgment are made by this document. The available form does not ask for a Codex session ID; none is included. Video remains deferred. Keep access tokens, sign-in links, invite codes, and sandbox credentials out of public fields.
