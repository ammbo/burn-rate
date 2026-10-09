# Deployment verification

## Domain migration — October 9, 2026

The canonical site is now `https://burnrating.com`. Wrangler 4.149.0 deployed version `5a126c13-7940-4cb4-b82f-a2175418377c` to `burnrating.com`, `www.burnrating.com`, `burnrateagents.com`, and `www.burnrateagents.com`.

This deployment started from the downloaded live Worker version `90593c3d-9031-41fa-9f24-9c7defd070c0` and its live public assets. Only domain routing, canonical/discovery URLs, and the operator domain changed. The in-progress local OpenRouter, Workflow, R2, and email-account changes were not released. The existing D1 database, Workers AI binding, secrets, quotas, sandbox payment mode, and cleanup schedule were retained.

The new domain was provisioned and checked first, with the old apex still serving the app. After those checks passed, the old domains were switched to permanent 308 redirects. Redirects retain paths and query strings and preserve HTTP methods. `www.burnrating.com` and HTTP also redirect to the HTTPS apex.

Verification:

- TypeScript and all 16 local security tests passed, including redirects before binding access and unchanged local-development routing.
- The exact downloaded production bundle passed independent redirect and canonical-host checks; the isolated Wrangler deployment passed its dry run.
- All eight public checks passed on the new domain before the final redirect switch: page metadata, discovery files, 404s, HTML aliases, API headers, disclosure placement, anonymous-generation rejection, and the local PayPal-loader check.
- After the final deployment, 23 live checks passed, including GET/HEAD/POST redirects for six noncanonical origins, canonical pages, API health/config, and following an old-domain redirect to a 200 response.
- Cloudflare and Google public DNS returned the new apex records. The machine initially cached the missing apex; live tests used fresh public DNS while retaining normal HTTPS certificate verification.
- No AI round, sign-in email, payment authorization, or capture was initiated by this migration.

The isolated deployment files and raw verification results are in ignored `.wrangler/burnrating-migration/`. The working source, Wrangler routes, future sign-in `APP_ORIGIN`, public generator, and tests were updated for the new canonical domain. The product name remains Burn Rate, and existing sender/support email addresses remain on `burnrateagents.com`; new-domain mailboxes were not configured.

Browser cookies and local drafts are scoped to their original domain. They were not transferred. A new session does not claim old cookie-owned rounds, although all existing database records remain available under the same public round URLs.

## Application hardening pass — October 8, 2026

Deployed the full Worker and assets with Wrangler 4.149.0 to both custom domains. Worker version `90593c3d-9031-41fa-9f24-9c7defd070c0`; startup 3 ms. The daily cleanup trigger is `17 5 * * *` (05:17 UTC). PayPal remains `sandbox`.

Confirmed:

- TypeScript check, deployment dry run, all ten local security/integration tests, and all eight live public-page tests passed. `npm audit` reports zero vulnerabilities after dependency updates.
- Anonymous generation returns 401; a foreign-origin mutation returns 403; an oversized request returns 413. Invite sign-in sets an HttpOnly, Secure, SameSite=Strict seven-day session cookie.
- Shared generation limits, session/IP limits, cooldown, rotation/expiry/logout, duplicate dispatch, duplicate settlement, retention, and SVG isolation passed real local D1 tests with mocked AI/PayPal.
- The local PayPal contract test creates an `AUTHORIZE` order for $2 and captures the selected $1 offer with `final_capture: true`. No real PayPal buyer approval or capture was initiated by these checks.
- The deployed API also created a real PayPal Sandbox order for a $2 ceiling and left it unapproved in `draft`, with no authorization, capture, or AI entries. This validates the server's sandbox order-creation credentials/API path, while buyer approval and partial capture remain unverified live.
- Live Workers AI memo round: `6424b3e4-ccd3-4172-bc07-995d8a87880f`, four completed offers, simulated $1.20 capture against a $2 ceiling.
- Live Workers AI image round: `09e28300-04e7-440b-b84d-73d417565e9e`, four completed offers and four real FLUX JPEGs, simulated $1.50 capture against a $2 ceiling.
- A separate invited session received 403 when trying to select the image round's winner. Anonymous selection received 401; an owner retry returned the existing resolution.
- HTTP and www redirects preserve path/query and return 308. Public briefs and receipts remain readable without access.
- The private invite secret was installed with Wrangler and kept in ignored `.launch-access.json` and `.dev.vars`; it is absent from source/docs. Three live request allowances were used (two AI rounds and one unapproved PayPal order), leaving 47 of the initial total 50 at verification time.

The real sandbox approval/capture flow, public GitHub visibility/source push, demo video, personal submission answers, and support mail delivery are still open. Public DNS resolvers returned no MX records for the domain. The cron was deployed and its cleanup logic tested locally; a scheduled production cleanup has not yet been observed. See `launch-checklist.md` and `launch-operations.md`.

## Earlier marketing deployment

Deployed October 8, 2026 to `burnrateagents.com` and `www.burnrateagents.com` with `npm run deploy`.

Worker version: `ddb3faa0-1191-40fa-859f-5cbc6ba9fc48`.

## Confirmed after deployment

- All six public verification tests passed against `https://burnrateagents.com`.
- Homepage, how-it-works, about, privacy, and terms return 200 with unique descriptions, canonical URLs, complete social metadata, and valid JSON-LD.
- Discovery files, SVG logo, OG PNG, favicon, touch icon, and manifest return 200 with the expected content types.
- Missing paths and assets return real 404s with noindex headers, including HEAD requests.
- HTML aliases redirect to the canonical paths.
- HTTP and www redirect with 308 to the HTTPS apex while preserving paths and query strings.
- API health returns 200 with no-store/noindex headers.
- Live config reports PayPal configured and `paypalMode: sandbox`, with the $0.50–$5 budget range.
- TypeScript checks and deployment dry run passed. Desktop, 390px mobile layout, the rendered PayPal button, and the keyboard skip link were checked locally.

No live job was created and no authorization or capture was initiated by these checks. Complete the sandbox buyer checkout test remotely using a sandbox account, or use the house tab for a simulated round. Support mailbox delivery and external social-platform cache refresh have not been verified.

See `launch-checklist.md` for buyer ownership, abuse limits, payment recovery, and other work before broad promotion or real-money payments. The marketing pass is deployed; it does not resolve those application-level gaps.
