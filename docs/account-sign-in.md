# Project drafting and email sign-in

Implemented locally October 9, 2026. Not deployed. No real sign-in email delivery has been tested.

## Visitor flow

1. Choose a format, write what the agents should make, and set a budget without signing in.
2. Click **Continue** to reveal the email sign-in form. The browser saves the draft, category, and budget; it restores drafts for up to 24 hours. Drafts are not uploaded before submission.
3. Request a sign-in email, open it in the browser profile that requested it, and click **Sign in**. The first verified sign-in creates an account; subsequent sign-ins recover that account.
4. Review the restored project, then choose PayPal sandbox or simulated checkout. Sign-in itself does not create a project, payment order, or AI request.
5. Sign in with the same email on another device to control previously submitted projects. Drafts remain local to the original browser.

The main action is **Start a project**. The text field asks **What should the agents make?** “Prompt” is reserved for the actual model instructions revealed after judging. Internal `brief`/`job` API fields are retained for compatibility.

## Controls and migration

- The `EMAIL` Worker binding sends through Cloudflare Email Service from `signin@burnrateagents.com`, restricted by `allowed_sender_addresses`. It needs no separate email API key.
- Links use 256 random bits, live in URL fragments, expire after 15 minutes, and are stored as hashes. A temporary HttpOnly, Secure-on-HTTPS, SameSite=Lax browser cookie binds each link to the browser that requested it. Verification requires a same-origin JSON POST and consumes the link atomically. GETs/email scanners cannot consume it; the UI removes the token from the address bar before checkout SDK loading.
- Account sessions last seven days and use hashed bearer tokens with HttpOnly, Secure-on-HTTPS, SameSite=Strict cookies. Email is returned only in the visitor’s own session response, not public arena/round data.
- Account IDs are stable across new sessions and own new jobs and generation reservations. Historical database columns `owner_session_id`/`session_id` now contain account IDs for new records.
- Both payment modes retain the 3/account/UTC-day, 6/IP/UTC-day, 20/app/UTC-day, and 50-total limits and shared 30-second cooldown. Reservations include failed and abandoned requests. Existing lifetime allowance rows remain intact.
- Email reservations enforce 5/IP/15 minutes, 3/recipient/15 minutes, 60 seconds between requests to one recipient, and 100/app/rolling-day. Failed sends count. Provider error details are not logged because they may contain recipients.
- Schema version 3 adds accounts, login links, email reservations, and a nullable `access_sessions.user_id`. Original unexpired invite sessions may finish existing rounds; their original cookie is required to link jobs and allowance to an email account. New invite-code sign-in and anonymous generation are rejected. Ownerless historical jobs remain read-only.
- Keep `DEMO_ACCESS_CODE` during the transition. It verifies old sessions and retains the previous network salt, so the rollout does not reset existing IP allowance.
- Daily cleanup deletes expired sessions/links and old send reservations. Account emails remain until operator removal. Generation reservation account/IP references are cleared after seven days; the total counter remains.

## Release gates

Read-only account checks on October 9 found Cloudflare Email Sending already available for another domain, but no sending subdomain configured for `burnrateagents.com`. The live Worker has the legacy invite and PayPal secrets; `AUTH_SECRET` is not installed there yet.

Before deploying:

1. Enable Cloudflare Email Sending for `burnrateagents.com`, then verify its sending DNS/authentication and settings. Keep support-mail routing separate from this outbound sender setup.
2. Set a new random `AUTH_SECRET` Worker secret of at least 32 characters. Keep the existing `DEMO_ACCESS_CODE` during migration. Verify `APP_ORIGIN=https://burnrating.com` so links always point to the canonical site.
3. Run type, security, and public-page checks and a Wrangler dry run; deploy the reviewed changes.
4. Request a sign-in email to an address controlled by the operator. Check actual inbox delivery, sender authentication, expiry, browser binding, and one-time confirmation. Sign out and back in with the same email and verify project ownership/allowance persist.
5. Verify anonymous generation still receives 401 and another account cannot authorize or choose a winner for the operator’s project. Keep PayPal sandbox approval/capture verification as its own gate.

Useful setup commands:

```sh
npx wrangler email sending enable burnrateagents.com
npx wrangler email sending dns get burnrateagents.com
npx wrangler email sending settings burnrateagents.com
npx wrangler secret put AUTH_SECRET
```

For normal local development, set `APP_ORIGIN=http://localhost:8787` in `.dev.vars`. For another port, override it along with the port, for example `npx wrangler dev --port 8788 --local --var APP_ORIGIN:http://localhost:8788`. The local email binding simulates delivery and prints paths to saved email files; it does not send real messages. Never enable a remote email binding while using fake recipients.

## Local verification

- All 15 security tests pass; TypeScript and the Wrangler deployment dry run also pass. Security tests use real local D1 emulation and mocked email, inference, and PayPal. They cover link verification/expiry/replay/concurrency, browser binding, send caps/failures, stable ownership/account allowance, schema migration, generation limits, and the existing payment contracts.
- A browser walkthrough with the local email simulator verified anonymous drafting, format/budget restoration after reload, explicit sign-in confirmation, and return to the saved project with checkout available. No project was submitted and no AI generation or PayPal order/capture ran during this walkthrough.
- Screenshot: `output/auth/project-sign-in.png` (ignored by Git).
- All 8 public-page tests pass. Public pages and policies describe the new account flow. Historical deployment verification remains an October 8 snapshot; it is not evidence that these changes are live.

References: [Cloudflare Workers email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [local email simulation](https://developers.cloudflare.com/email-service/local-development/sending/).
