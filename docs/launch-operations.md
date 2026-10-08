# Hosted sandbox operations

## Access and spending

The deployment requires `DEMO_ACCESS_CODE` as a Worker secret. The operator's generated code is stored in the ignored, mode-0600 `.launch-access.json` file. Copy the code into the **private judge testing instructions** field. Never put it in the project story, public repository, screenshots, a video, or a URL. Local development also has this code in ignored `.dev.vars`.

All new rounds, including PayPal sandbox rounds, reserve an allowance before calling PayPal or Workers AI. The deployed limits are 3 requests per browser per UTC day, 6 per IP per UTC day, 20 per UTC day across the app, and 50 total. A shared 30-second cooldown and an in-progress round check apply. Failed and abandoned requests count. The total cap is deliberately small for the initial launch; the operator must raise it before prolonged judging if it has been exhausted.

The worst case across 50 requests is 400 Llama text calls and 200 FLUX image calls. Text outputs are capped at 160/900 tokens and images at eight steps. Agent wallets are simulated accounting and do not bound actual provider spending. App allowance limits do; they do not cap unrelated Cloudflare services or the whole account invoice.

To pause new inference, change `GENERATION_ENABLED` to `"false"` and run `npm run deploy`. To revoke invite access, rotate `DEMO_ACCESS_CODE` with `npx wrangler secret put DEMO_ACCESS_CODE`. Rotation also invalidates all existing sessions and their ability to settle old rounds. Do not rotate while a buyer is in a round unless accepting that loss of access.

Email magic links are an optional future identity layer. They require a verified sender, mail credentials, single-use expiring tokens, and email-send throttles. They would still need the shared cap because verified email addresses are cheap to create. No Resend integration or email sending was added to this launch.

## Data and removal

`wrangler.jsonc` enables structured application logs, disables invocation logs, and disables traces. Logs contain operational IDs and payment references; the app does not intentionally log raw briefs, session tokens, invite codes, or IP addresses. Cloudflare documents Workers Logs retention as three days on Free and seven on Paid; the account's plan/other log export destinations were not independently audited. [Workers Logs documentation](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

Cloudflare states that it does not use Workers AI customer content to train models or improve its services without explicit consent. The app explicitly stores work in D1, which has its own lifecycle. This is not a claim that every provider copy or backup disappears after app cleanup. [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/).

The daily cleanup runs at 05:17 UTC. It removes briefs, entries, and corresponding journal versions after 30 days for house rounds and settled, failed, or draft PayPal rounds. It retains unresolved authorized PayPal records for reconciliation. Expired access sessions and attempt counters are removed; browser and IP hashes in allowance rows are cleared after seven days. The allowance rows remain to enforce the total cap. Ledger notes and current/historical agent journals can retain references and need separate review for removal requests.

For a removal request:

1. Obtain the round URL privately through support@burnrateagents.com; never request PayPal passwords or card details.
2. Find the job, its entries, generated prompts/output, journal versions, current agent journals, and ledger rows referencing the job.
3. Reconcile any open sandbox authorization before deleting payment-related records.
4. Remove the requested content and redact identifying references in journals/ledger notes. Retain an anonymized allowance row so deletion cannot reset spending protection.
5. Explain the scope of app removal and the independent provider/log/backup retention. Verify that the public job URL no longer exposes the removed content.

Support mailbox delivery and who handles requests still need an operator check. No test email was sent.

## Verification and remaining payment work

`npm run test:security` uses real local D1 emulation with mocked inference and mocked PayPal HTTP responses. It checks ownership, sessions, origin and payload restrictions, concurrent quota requests, shared limits, duplicate dispatch, duplicate settlement, retention, SVG rendering, and the authorize-then-final-partial-capture contract. It does not prove an actual PayPal buyer approval or capture.

The real sandbox buyer test must use a sandbox Personal account distinct from the sandbox merchant. Approve a ceiling, choose an offer, and compare the authorization, capture, and unused remainder in the PayPal dashboard. Keep the same Burn Rate browser session throughout. Do not use real PayPal credentials.

Before real-money payments, implement durable reconciliation, webhooks, cancellation/voiding, expiry and recovery, capture/database failure handling, pending-payment states, and refunds. The hosted setting remains `PAYPAL_MODE=sandbox`.
