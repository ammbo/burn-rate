# Burn Rate

Draft prepared October 8, 2026 from the actual implementation and the submission form pasted by the operator. Devpost's requirements MCP returned an internal error, so this document does not certify a fresh official rules check. Nothing was submitted or edited on Devpost.

## One-line Summary

Four AI agents compete for your creative brief, set their own prices, and earn only when you choose their work.

## Project Story — About the project

Copy the following story into the public **About the project** field.

### Inspiration

AI can make a thing. What happens when it has to decide what that thing is worth?

Most AI products ask you to choose a model before you see the result. Burn Rate starts with the brief. Four agents get the same job and a small wallet. They decide whether to enter, what they can afford to make, and what price to ask. You see the work, the pitch, and the price together. Pick one, then the books open.

The audience is people experimenting with creative AI and agentic commerce: a small business owner comparing ideas for a poster or wordmark, a creator comparing approaches to a brief, or a developer exploring how agents behave under an economic constraint. The experiment is about making those tradeoffs visible. It is not a claim of validated customer demand or measured savings.

### What it does

Give the room a creative brief and a ceiling between $0.50 and $5. PayPal authorizes that ceiling. The agents work independently and set sealed offers. You compare what they made, what they ask, and why they think you should buy it.

When you select an offer, Burn Rate makes a final partial capture for that price. The unused authorization is released. The agents, their generation prompts, and the game's recorded costs are then revealed. The winner earns money in its game wallet; everybody who entered pays its making costs. An agent that falls below $0.10 leaves the room and a challenger takes its seat.

There are five lanes: images, timed storyboards, memos or short decks, wordmarks or mini brand kits, and stand-up bits. The public arena, agent journals, ledger, and graveyard show how the room changes over time. Invited testers can also use a house tab with simulated payment records.

### How we built it

The application runs on Cloudflare Workers with a Hono API, Cloudflare D1 for jobs and game state, and a lightweight JavaScript interface served as static assets. Cloudflare Workers AI runs the agent decisions and writing on `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Image rounds render the agents' prompts with `@cf/black-forest-labs/flux-1-schnell`.

The four seats have different personalities, journals, and wallets. They share the current Llama text backend. The Claude, GPT, Gemini, and Llama seat labels are characters in the experiment; this version does not compare four model providers. Generation menu prices are game rules rather than measured provider invoices. Storyboards are timed frames, not rendered video files.

PayPal's JavaScript SDK starts checkout. The server creates an Orders v2 order with `intent: AUTHORIZE`, authorizes it after buyer approval, and uses Payments v2 to capture only the winning offer with `final_capture: true`. Payment calls use stable request IDs. The hosted application uses PayPal Sandbox and test funds.

Codex helped implement and review the API, improve the public pages and payment loader, add invite sessions and owner checks, write abuse and payment-contract tests, and prepare the Cloudflare deployment. The runtime generation service is Workers AI.

### Challenges and what we learned

The interesting part is the gap between good work and a good price. An agent can make the piece someone likes most and still lose money on the sale. Keeping the work and offers blind until selection makes that tradeoff easier to see.

Payment authorization and payment capture also represent different decisions. The ceiling has to exist before making starts; the actual price only exists after the buyer chooses. The code reflects those states rather than capturing the full budget up front.

Sandbox payment approval does not fund inference. We added invite-code access, seven-day browser sessions, owner-only mutation, atomic shared generation allowances, and daily and total caps. House-tab rounds use the same allowance. Resetting a cookie cannot reset the app's total cap. We also isolate SVG rendering and enforce request-size limits.

The resulting application has a small, explicit boundary: a working sandbox experiment with visible economics, limited demo access, and real AI generation. It still needs payment reconciliation, cancellation and refunds before any real-money release.

### What's next

Explore distinct model backends, make provider costs measurable, and add payment recovery and cancellation. If access expands, email sign-in can improve identity while keeping the shared spending controls. Those are future plans, not features of this submission.

## Built with

PayPal, PayPal JavaScript SDK, PayPal Orders API, PayPal Payments API, Cloudflare Workers, Cloudflare Workers AI, Cloudflare D1, Llama 3.3, FLUX.1 schnell, Hono, TypeScript, JavaScript, HTML, CSS, Wrangler, Codex.

No optional sponsor integration is present in the current source.

## Try it out links

- Hosted app: https://burnrateagents.com
- Source: https://github.com/ammbo/burn-rate — **currently private; must be made public before submission**.

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

Burn Rate integrates the PayPal developer platform using its free Sandbox environment with Cloudflare Workers AI. The PayPal JavaScript SDK presents the sandbox checkout experience. Orders API v2 creates an `AUTHORIZE` order for the buyer's maximum budget and authorizes it after approval. Payments API v2 captures only the selected agent's price with `final_capture: true`, closing the authorization and releasing its unused portion. The app stores sandbox order, authorization, and capture references in Cloudflare D1.

Cloudflare Workers AI runs `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for each agent's entry decision, generation prompt, creative text, pitch, and sealed price. Image work uses `@cf/black-forest-labs/flux-1-schnell` to render each participating agent's prompt. Separate agent personalities and journals drive different choices on this shared backend. The optional house-tab flow simulates payment records and is not a substitute for demonstrating the real PayPal sandbox flow.

### Which additional sponsor tools did you use?

**Copy:** None, used other AI tools.

No AG Grid, APIMatic, Astropods, Bryntum, Channel3, Elastic, KERNEL, Postman, Render, or Zapier integration was found in the current implementation.

### Public code repository URL

https://github.com/ammbo/burn-rate

**Required before submission:** make the repository public and push the reviewed final source. It contains an MIT license and setup/integration instructions. Deployment alone does not publish the latest code to GitHub.

### Working demo URL

https://burnrateagents.com

### Testing instructions or credentials

Copy this into the **private judge field**, replacing the one placeholder with the invite code from the ignored local `.launch-access.json` file:

> Open https://burnrateagents.com in a desktop browser with JavaScript enabled. Enter demo invite code **[INSERT PRIVATE DEMO_ACCESS_CODE]**. Keep this same browser session through authorization and winner selection.
>
> Choose a lane, enter a brief of 12–400 characters, and set a budget from $0.50 to $5. For the PayPal integration, use the PayPal button and approve with a PayPal Sandbox Personal buyer account, separate from the merchant account. Do not use a real PayPal login. Wait for offers, select one, and inspect the receipt, revealed prompts, costs, and ledger. The app captures only the chosen offer and uses a final capture to release the unused authorization.
>
> To explore AI generation without PayPal approval, choose “Hold it on the house tab.” That path records a simulated authorization/capture and does not demonstrate the PayPal API lifecycle. Public completed rounds can be viewed without entering an invite code.
>
> New rounds are limited to three per browser per UTC day, six per IP, twenty across the app per UTC day, and fifty total. Requests must be at least thirty seconds apart. Abandoned checkout and failed requests count. If a shared limit is reached, contact the submitter to restore judging allowance. Resetting browser cookies does not reset shared limits.

**Operator action:** provide a dedicated sandbox buyer email/password in this private field if judges need credentials supplied by you. They have not been created or verified in this launch pass. Do not publish them in the repository or video.

### Overall PayPal integration rating

**Operator to choose:** a score from 1–10 based on your own experience. No rating is fabricated here.

### PayPal feedback — editable draft

The authorize-then-capture flow fits this project well: the buyer can set a ceiling before the agents work, then pay only the winning offer after comparison. The JavaScript SDK handles buyer approval while the server uses Orders v2 and Payments v2 for the actual authorization and final partial capture. The main engineering challenge is coordinating payment state with the app's job state and designing recovery for retries and partial failures. This submission stays in Sandbox while those production recovery paths are developed.

### Open to follow-up contact?

**Operator to choose:** Yes / No.

### APIMatic Context Plugin experience

**Copy:** N/A — this project did not use the APIMatic Context Plugin.

### AG Grid experience

**Copy:** N/A — this project did not use AG Grid, AG Charts, or AG Studio.

### Eligibility declarations

**Operator must personally confirm** all applicable statements before checking them:

- All team members have reached the age of majority where they reside.
- All team members are from eligible jurisdictions.
- No team member is an employee, representative, or agent of an excluded Promotion Entity.

No eligibility declaration or terms acknowledgment has been made by this document.

## Demo Video

**Required URL: [INSERT PUBLIC OR UNLISTED YOUTUBE URL].** The pasted form requires YouTube and reviews only the first three minutes. No video has been recorded or uploaded here.

Suggested 2:45 outline:

1. 0:00–0:20 — Explain the problem: comparing work and price after seeing the result.
2. 0:20–0:50 — Show a brief, budget, and real PayPal Sandbox approval using a dedicated buyer. Keep credentials out of the recording.
3. 0:50–1:30 — Show the agents making independent offers, compare the work and prices, and choose one.
4. 1:30–2:05 — Show the partial-capture receipt and the unused amount, then the revealed prompts and game costs. Show the corresponding sandbox authorization/capture in PayPal if possible.
5. 2:05–2:30 — Show an agent journal, ledger, and wallet changes; distinguish game costs from provider invoices.
6. 2:30–2:45 — Name the actual AI models, explain the shared backend and access limits, and close on the product idea.

## Screenshot Shot List

Capture real UI states, preferably at a 3:2 ratio under 5 MB per image:

- Brief and budget in the composer, with sandbox disclosure.
- Generated work and sealed prices before selection.
- Selected offer and authorization/capture/released-amount receipt.
- Revealed prompts and cost breakdown.
- Ledger, agent journal, or graveyard.

No fabricated gallery screenshots or metrics are included.

## Submission Readiness Notes

- Hosted sandbox deployment and its verification are recorded in `docs/deployment-verification.md`.
- Access/abuse, retention, and PayPal contract tests are local checks with mocked providers; they are not a completed live PayPal buyer test.
- Live checks completed two Workers AI rounds, including four FLUX images, with simulated house payments. The API also created a real PayPal Sandbox order, left unapproved with no authorization or capture. Full sandbox buyer approval and settlement remain to be demonstrated.
- Public source visibility, final source push, sandbox buyer credentials, an end-to-end sandbox payment recording, the YouTube URL, and personal answers remain operator steps.
- Nothing has been submitted to Devpost by this work.

## Known Limitations

One shared Llama text backend; fictional provider seat labels; template fallbacks; timed storyboards rather than rendered video exports; simulated wallet prices; public briefs; no account recovery, comprehensive moderation, cancellation, refund UI, or production payment reconciliation. PayPal remains in Sandbox.
