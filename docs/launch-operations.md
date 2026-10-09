# Hosted sandbox operations

## Access and spending

The October 9 checkout replaces new invite-code access with Cloudflare email-link sign-in. This rollout is implemented and verified locally, and has not been deployed. See [account sign-in and rollout](account-sign-in.md) for sender setup, secrets, and release verification. The previous live deployment still uses the invite code until this rollout is completed.

The new deployment requires a verified Cloudflare Email Sending domain, the `EMAIL` binding, `EMAIL_FROM`, a random `AUTH_SECRET` Worker secret, and the canonical `APP_ORIGIN`. Retain the existing `DEMO_ACCESS_CODE` during migration so old invited browsers can finish rounds or claim them by signing in. New invite-code sign-ins are disabled. Do not publish either secret or sign-in links.
All new rounds, including PayPal sandbox rounds, reserve an allowance before calling PayPal or Workers AI. The configured limits after account rollout are 3 requests per account per UTC day, 6 per IP per UTC day, 20 per UTC day across the app, and 50 total. A shared 30-second cooldown and an in-progress round check apply. Failed and abandoned requests count. The total cap is deliberately small for the initial launch; the operator must raise it before prolonged judging if it has been exhausted.

The worst case across 50 requests is 400 Llama text calls and 200 FLUX image calls. Text outputs are capped at 160/900 tokens and images at eight steps. Agent wallets are simulated accounting and do not bound actual provider spending. App allowance limits do; they do not cap unrelated Cloudflare services or the whole account invoice.

To pause new inference, change `GENERATION_ENABLED` to `"false"` and run `npm run deploy`. Existing account owners can still choose winners. To revoke an individual account’s sessions, delete its rows from `access_sessions` by `user_id`; retain the account, jobs, and generation reservations. Do not rotate the legacy invite code while an invited browser still needs access to an old round.

Email requests are separately limited to 10 per IP / 15 minutes, 5 per recipient / 15 minutes, one per recipient per 15 seconds, and 100 app-wide per rolling 24 hours. Failed sends count. Link verification consumes a token atomically and requires its originating browser cookie; simply opening a link does not sign in. Email sign-in still needs the shared generation cap because verified addresses are easy to create.

## Data and removal

`wrangler.jsonc` enables structured application logs, disables invocation logs, and disables traces. Logs contain operational IDs and payment references; the app does not intentionally log raw briefs, email addresses, sign-in links, session tokens, invite codes, or IP addresses. Cloudflare documents Workers Logs retention as three days on Free and seven on Paid; the account's plan/other log export destinations were not independently audited. [Workers Logs documentation](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

Cloudflare states that it does not use Workers AI customer content to train models or improve its services without explicit consent. The app explicitly stores work in D1, which has its own lifecycle. This is not a claim that every provider copy or backup disappears after app cleanup. [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/).

The daily cleanup runs at 05:17 UTC. It removes briefs, entries, and corresponding journal versions after 30 days for house rounds and settled, failed, or draft PayPal rounds. It retains unresolved authorized PayPal records for reconciliation. Expired access sessions, sign-in links, and attempt counters are removed; email-send reservations expire after 24 hours. Account references and IP hashes in allowance rows are cleared after seven days. Account emails and IDs remain until operator removal. The allowance rows remain to enforce the total cap. Ledger notes and current/historical agent journals can retain references and need separate review for removal requests.

For a removal request:

1. Obtain the round URL privately through support@burnrateagents.com; never request PayPal passwords or card details.
2. Find the job, its entries, generated prompts/output, journal versions, current agent journals, and ledger rows referencing the job.
3. Reconcile any open sandbox authorization before deleting payment-related records.
4. Remove the requested content and redact identifying references in journals/ledger notes. For account removal, revoke its sessions, delete outstanding login links for the email, and remove the account email/ID. Retain allowance reservations through their quota window; do not reset spending protection.
5. Explain the scope of app removal and the independent provider/log/backup retention. Verify that the public job URL no longer exposes the removed content.

Support mailbox delivery and who handles requests still need an operator check. No test email was sent.

## Verification and remaining payment work

`npm run test:security` uses real local D1 emulation with mocked inference and mocked PayPal HTTP responses. It checks email verification, token expiry/replay, browser binding, send quotas, stable account ownership and allowance, v2 migration, draft persistence, sessions, origin and payload restrictions, concurrent quota requests, shared limits, duplicate dispatch, duplicate settlement, retention, SVG rendering, and the authorize-then-final-partial-capture contract. It does not prove an actual PayPal buyer approval or capture.

The real sandbox buyer test must use a sandbox Personal account distinct from the sandbox merchant. Approve a ceiling, choose an offer, and compare the authorization, capture, and unused remainder in the PayPal dashboard. Keep the same Burn Rate browser session throughout. Do not use real PayPal credentials.

Before real-money payments, implement durable reconciliation, webhooks, cancellation/voiding, expiry and recovery, capture/database failure handling, pending-payment states, and refunds. The hosted setting remains `PAYPAL_MODE=sandbox`.
