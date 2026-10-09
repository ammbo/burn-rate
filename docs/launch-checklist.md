# Burn Rate public launch checks

The site can be publicly hosted while PayPal stays in sandbox mode. A deployed app does not imply real-money payment readiness.

## Included in the marketing pass

- Readable static homepage, accurate introductory copy, how-it-works and about pages.
- Per-page titles, descriptions, canonical URLs, Open Graph and Twitter cards, and JSON-LD for the site, operator, app, pages, and breadcrumbs. No invented reviews, pricing offers, or ratings.
- Matching SVG/PNG logo assets, browser/touch icons, and a 1200×630 social image.
- robots.txt, sitemap.xml, llms.txt, and an icon manifest. Hash views and application APIs are not advertised as indexable pages.
- Branded 404s with real GET/HEAD 404 status, noindex headers, HTML canonicalization, and redirects from HTTP/www to the HTTPS apex domain that preserve paths and queries.
- Privacy and terms pages based on the current code, with BurnRateAgents.com and support@burnrateagents.com as supplied by the operator.
- Visible sandbox and public-submission notices, accessible form labels, a skip link, keyboard focus styling, and a readable page when the API is unavailable.
- PayPal SDK loader fix: a DOM element named `paypal` can no longer be mistaken for the SDK; failed SDK loads can be retried and show a readable fallback message.

## Before promoting the hosted sandbox

- [x] Deploy the app and check the sitemap documents, actual GET/HEAD 404s, canonical aliases, and HTTP/www redirects on the real domain. See `deployment-verification.md`.
- [ ] Inspect the social card with an external platform preview tool; cached previews can retain earlier content. The deployed card/metadata endpoints are checked.
- [ ] Confirm support@burnrateagents.com receives mail and assign an owner for privacy/removal requests. **No MX records were returned by 1.1.1.1 or 8.8.8.8 on October 8; mail routing still needs setup or correction.** No email was sent.
- [ ] Complete a real PayPal sandbox buyer approval and winner-selection flow; compare the authorization, final partial capture, and released remainder in PayPal. A real sandbox order was created without approval or inference; the authorize/capture contract passed a mocked integration test. Buyer approval and capture remain unverified against PayPal.
- [x] Add invite-code browser sessions and owner checks for authorization and winner selection. API enforcement and live cross-session rejection were verified. Older ownerless jobs are read-only.
- [x] Require access for both house-tab and PayPal rounds. Add atomic D1 limits: 3/browser/day, 6/IP/day, 20/app/day, 50 total, and a shared 30-second cooldown. Failed/abandoned requests count. Repeat callbacks cannot restart generation.
- [x] Bound each round to at most eight text calls and four image calls, cap output tokens/image steps, and keep the compulsory fallback free of extra inference.
- [x] Render SVG as inert image content, allow only bounded image data URLs and hex colors, escape displayed text, and enforce 4 KB request bodies and same-origin mutations. Tests passed. Comprehensive moderation is deferred; generation access remains invite-only and reports use the published support contact.
- [x] Disable traces/invocation logs, retain structured operational logs, document provider handling, and add daily expiry for eligible briefs/outputs after 30 days. Historical journals/game records, unsettled PayPal authorizations, provider copies, and backups need separate consideration. See `launch-operations.md`.
- [x] Deploy and exercise a real memo round and image round through Workers AI, then select winners with simulated house payments. Four FLUX images rendered successfully. This does not certify PayPal settlement.
- [x] Prepare copy/paste answers for every pasted submission field, a story, testing instructions, and a video outline in `../devpost-submission.md`. Personal answers and credentials remain clearly marked.
- [ ] Publish the final source to the public MIT-licensed GitHub repository. The repository is currently private; deployment did not change visibility or push uncommitted files.
- [ ] Record a real end-to-end sandbox payment demo and upload the required YouTube video. Finish personal/eligibility answers and confirm event requirements live. Devpost's requirements service returned an internal error during this pass; no submission was made.

OpenRouter is not required for this launch: the deployed text and image models already run through Workers AI. Additional model providers can be added later without opening anonymous generation.

## Before enabling real-money payments

- Keep `PAYPAL_MODE=sandbox` until this review is complete.
- Implement buyer ownership and authorization checks, durable payment reconciliation, webhook handling, and recovery if PayPal succeeds while the database write fails.
- Add cancellation/authorization voiding, expiry, failed-round recovery, and a documented refund/support process. The current build has no reject-all, automatic expiry, or in-app refund flow.
- Test duplicate callbacks, retries, concurrent winner selection, authorization expiry, declined captures, and capture/database failures against PayPal records.
- Update terms, privacy, payment disclosures, static marketing copy, llms.txt, and the social image to match the actual live-payment service. Obtain appropriate legal review of the final operator/business terms.
- Decide analytics and consent requirements from the providers and settings actually deployed. No advertising or analytics SDK was added in this pass.

## After deployment

- Verify domain ownership in the search engines you use and submit `https://burnrateagents.com/sitemap.xml`. No search-console account changes or submissions were made here.
- Check mobile layout, keyboard navigation, broken links, and provider outages on the deployed build. Local public/access checks passed; current device testing and external preview caches remain separate.
- Treat llms.txt as descriptive information, not a standard that guarantees discovery, inclusion, training exclusion, or agent authorization.

## Reference sources

- [Cloudflare static HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/)
- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [PayPal sandbox accounts](https://developer.paypal.com/tools/sandbox/accounts/)
- [Hackathon](https://paypalaihackathon.devpost.com/)

## October 9 account rollout (local, pending release)

- [x] Allow anonymous project drafting, with email sign-in on Continue and browser draft restoration.
- [x] Add single-use, expiring, browser-bound email links and stable account ownership/quotas.
- [x] Preserve existing global/network spending caps and original-cookie migration for old rounds.
- [x] Add native Cloudflare email binding and throttled email requests; update public copy/policies.
- [ ] Enable/verify Email Sending for burnrateagents.com and install the AUTH_SECRET Worker secret.
- [ ] Deploy, verify real sign-in email delivery, and repeat hosted authorization/ownership checks.

The invite-code checks above describe the October 8 deployment. The account flow has not yet replaced it in production.
