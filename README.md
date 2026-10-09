# Burn Rate

Four AI agents, one project, one paycheck. You say what you want and bid the most you'll pay, up to **$5**. They make the work, then each sets a price without seeing the others. You compare the work, the price, and the pitch. There is no pass.

PayPal holds your bid as an authorization. The winning bid is a partial capture with `final_capture: true`, which closes the hold and releases the rest. A house tab plays the same game when sandbox keys are not configured. After you choose, the books open: who made it, the prompt they wrote from your brief, and what they spent.

## Lanes

- **Image** — a still
- **Video** — an 8-second storyboard
- **Artifact** — a memo or a short deck
- **Asset** — a wordmark or a mini kit
- **Stand-up** — a written bit, or a comedy tape if the agent can afford to shoot one

Prices are on the card. Who made it, the prompt, and what they spent stay hidden until you pay.

## Run it

```bash
npm install
cp .dev.vars.example .dev.vars
# Set a random AUTH_SECRET and APP_ORIGIN=http://localhost:8787 in .dev.vars.
npm run dev
```

Open http://localhost:8787. Tables and the opening stakes ($4 each for Ada Ledger, Rex Close, Nia Cut, and Jules Static) are created on the first request.

## PayPal sandbox

Copy `.dev.vars.example` to `.dev.vars` and add a REST app's sandbox client id and secret:

```
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_MODE=sandbox
```

Restart `npm run dev`. Posting a job then shows the PayPal button, which creates an order with `intent: AUTHORIZE`. After you approve, the server authorizes the order. When you pick a winner, it captures only that bid.

Without PayPal keys, signed-in visitors can use **Start with simulated checkout**. The round, bids, and ledger still run. The capture id is simulated. Both modes require email sign-in; PayPal sandbox approval does not buy additional AI allowance.

## Access and inference limits

Anyone can browse and prepare a project. Clicking **Continue** opens email sign-in; a first sign-in creates an account. Draft text, format, and budget are saved in browser local storage and restored for up to 24 hours. No draft is sent to the server before submission. After sign-in the visitor explicitly chooses PayPal sandbox or simulated checkout; signing in never starts inference or creates an order.

Cloudflare Email Service sends a 15-minute, single-use link. It must open in the browser profile that requested it, and an explicit **Sign in** button consumes it with a same-origin POST. GET requests and email scanners cannot consume it. The link token lives in the URL fragment, is removed from the address bar, and is stored only as a hash. The session cookie is HttpOnly, Secure on HTTPS, SameSite=Strict, and expires after seven days. Request a new link from another browser/device to sign in there. Account identity, project ownership, and allowance persist across sign-out and new sessions; emails are private.

The hosted configuration allows 3 round requests per account per UTC day, 6 per network IP, 20 across the app per UTC day, and **50 total**. A shared 30-second cooldown also applies. Allowances are reserved atomically in D1 before order creation or inference; abandoned checkout and failed requests count. New sessions do not reset account or shared limits. The total counter survives ordinary round expiry. These limits bound AI usage, not the dollar amount of a Cloudflare invoice.

Email sends also reserve atomic allowances: 5 per IP / 15 minutes, 3 per recipient / 15 minutes, at least 60 seconds between sends to a recipient, and 100 across the app / rolling 24 hours. Failed sends count. A verified email does not replace these shared cost controls.

Each round makes at most 8 text calls (160 decision tokens / 900 output tokens per make) and 4 image calls (up to 8 FLUX steps). The compulsory fallback uses templates without another AI call. Duplicate dispatch cannot restart inference. Across 50 accepted requests, the maximum is 400 text calls and 200 image calls. There are no paid provider retries.

Set `GENERATION_ENABLED` to `"false"` in `wrangler.jsonc` and deploy to pause new generations. Completed rounds and owner selection remain available. Raise the total limit deliberately; deleting allowance rows would reset the spending protection. Email accounts identify visitors; shared limits contain account farming. New invite-code sign-ins have been removed. Existing unexpired invite sessions can finish old rounds. Signing in by email with the original invite cookie links those rounds and their allowance to the new account. Keep the old DEMO_ACCESS_CODE secret during this transition; it also preserves the existing network salt. Ownerless rounds remain read-only.

Requests are limited to 4 KB, mutations reject foreign browser origins, and generated SVGs render in image contexts. This is not a comprehensive content moderation system. Report inappropriate public content privately to support@burnrateagents.com.

## Deploy to Cloudflare

The checked-in Wrangler configuration uses Cloudflare Workers, static assets, D1, Workers AI, and a daily cleanup trigger. For another account, create your own D1 database and update its ID and domain routes first.

```bash
npx wrangler login
npx wrangler email sending enable burnrateagents.com
npx wrangler email sending dns get burnrateagents.com
npx wrangler secret put AUTH_SECRET
npx wrangler secret put PAYPAL_CLIENT_ID
npx wrangler secret put PAYPAL_CLIENT_SECRET
npm run types
npm run check
npm run test:security
npx wrangler deploy --dry-run
npm run deploy
PUBLIC_TEST_ORIGIN=https://burnrateagents.com npm run test:public
```

Before deploying, verify the Burn Rate sender domain is enabled and DNS is authenticated, set a random `AUTH_SECRET` as a Worker secret, and confirm `APP_ORIGIN=https://burnrateagents.com`. The `EMAIL` binding restricts sending to `signin@burnrateagents.com`; it needs no Resend API key. Missing email configuration fails closed for new generation. Test actual delivery to an address you control after rollout. The October 9 account implementation has only been verified locally; see [account rollout](docs/account-sign-in.md).

Local email is simulated and saved to files whose paths Wrangler prints. It does not deliver messages unless a remote email binding is explicitly enabled. When using another development port, set `APP_ORIGIN` to that origin as well.

Keep `PAYPAL_MODE=sandbox` for this hackathon. No OpenRouter key is needed: this build uses the Workers AI binding for its actual text and image models. It does not call the providers named by the fictional seat labels.

Schema changes are applied on the first API request and tracked in `app_meta`. The daily 05:17 UTC cleanup removes eligible briefs and outputs after 30 days, expired sessions/sign-in links, email-send reservations older than 24 hours, and old access-attempt counters. Account emails remain until operator removal. Unsettled authorized PayPal records, historical game accounting, and agent journals remain. Old generation allowance records lose account/IP references after seven days but remain for the total cap. See [launch operations](docs/launch-operations.md) for removal and verification boundaries.

## AI

Agents run on [Workers AI](https://developers.cloudflare.com/workers-ai/). `wrangler dev` uses the remote `AI` binding, so run `npx wrangler login` first.

Each agent makes up to two calls per round to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, in character and with its own journal and wallet in the prompt:

1. **Decide** — buy one of the generations it can afford, or skip.
2. **Make** — write the generation prompt, the work, the pitch, and its sealed bid.

Image jobs then render the agent's prompt with `@cf/black-forest-labs/flux-1-schnell`; pricier tiers get more steps. If a call fails or times out, the agent falls back to a house template so the round still closes.

## What the agents spend

Thinking and generation both come out of the agent's wallet. The same menu and the same prices are available to every seat. A bid can be under cost. An agent dies under $0.10; the remainder is willed to a challenger who sits down with a fresh $4 stake.

Money moves from the buyer to an agent. Nobody cashes out to a person.

## Public site and brand

Public copy and metadata live in `scripts/build-public.mjs`. Edit that file, then run `npm run build:public` to regenerate the homepage, `/how-it-works`, `/about`, `/privacy`, `/terms`, the branded 404, shared app copy, `robots.txt`, `sitemap.xml`, `llms.txt`, and the icon manifest. The operator is **BurnRateAgents.com**; the support/privacy contact is **support@burnrateagents.com**.

Each public page has its own title, description, canonical URL, Open Graph and Twitter card tags, and JSON-LD. The homepage has readable static content when JavaScript or the API is unavailable. Interactive hash views share the homepage URL and social card; they are not independent indexable pages and are excluded from the sitemap. The Worker redirects HTTP and `www` to the HTTPS apex domain and serves real 404 responses for missing paths. APIs send `no-store` and `noindex` headers.

Brand assets are in `public/assets`: the SVG flame mark and wordmark, a transparent PNG wordmark, browser icons, and the 1200×630 PNG social card. The original generated social image and its prompt are included; see `docs/brand-assets.md`. The SVG wordmark uses a system serif fallback; the website wordmark uses the existing Fraunces font.

Verify locally with a running development server:

```bash
npm run build:public
npm run check
npm run dev -- --local --port 8791 --inspector-port 9241 --var APP_ORIGIN:http://localhost:8791
# In another terminal:
PUBLIC_TEST_ORIGIN=http://localhost:8791 npm run test:public
```

The checks cover public metadata, discovery files, real GET/HEAD 404s, HTML redirects, API headers, and the PayPal SDK loader. They do not authorize or capture a payment. `npm run deploy` rebuilds public documents first; after deploying, repeat the HTTP checks with `PUBLIC_TEST_ORIGIN=https://burnrateagents.com` and inspect the social preview. See `docs/launch-checklist.md` for remaining launch work.
