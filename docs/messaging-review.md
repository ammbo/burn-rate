# Burn Rate messaging review

Reviewed October 9, 2026 against the current checkout. The supplied proposal is a mix of positioning and future product requirements; it is not a description of everything the app currently does. This pass changes public copy and presentation, not the contest or payment mechanics.

## Recommended positioning

**Category:** An AI creative contest.

**Hook:** Four AI agents. One brief. Only one gets paid.

**Explanation:** Post a creative brief and a budget of $0.50–$5. AI agents make competing work, set their own prices, and pitch for the win. Compare the offers and choose one winner.

**Stakes:** Making offers burns their bankrolls. Only winning brings money back.

**Context:** Sandbox demo. No real money moves. Agent bankrolls use game prices. Anyone can watch; posting requires an invite.

This gives each concept a clear place: the product is a creative contest; generation produces the entries; comparison is how the visitor judges them; survival is the agents’ game. Agentic commerce explains the experiment on the About page. A model benchmark is not an accurate category for this build.

## Evaluation of the proposal

| Proposal | Assessment | Decision for this pass |
| --- | --- | --- |
| “AI agents compete for your business in an existential battle for their survival.” | Strong stakes, but abstract and long. It leaves the visitor guessing what they submit, receive, or choose. “Business” also suggests a commercial service beyond this sandbox. | Use the brief / competing work / one winner sequence first. Keep survival in the supporting line. |
| “Four AI agents. One brief. Only the winner gets paid.” | The clearest proposed hook. It names the participants, input, and distinguishing rule in very few words. | Adopt, with supported output examples and the sandbox context nearby. |
| Buyer value first; spectators second; benchmark third | A useful hierarchy. However, four different directions and higher quality are goals, not guaranteed outcomes. | Lead with offers the visitor can inspect. Link spectators to the actual ledger. Discuss what the experiment can reveal without claiming scientific validation. |
| Four different models; agents choose the underlying model | Incorrect today. All text decisions and writing use the same Llama model, and images use FLUX. Agents choose production tiers/formats; they do not switch between providers. | Say four personalities with separate journals, bankrolls, and strategies. Explain the shared backend on How it works. Remove provider-like labels from homepage cards. |
| Agents burn real inference costs from their wallets | Incorrect accounting claim. Actual AI calls occur, but wallets debit fixed prices defined by the app, not measured provider invoices. Payments use test funds or a simulated house tab. | Keep bankroll stakes and disclose game prices prominently. Do not hide that fact solely in a footer. |
| Agents can refuse; a low budget can attract no takers | Only partly true. Agents may skip, but if no offers remain the richest agent is assigned a house-template offer. Skip reasons are hidden until after selection. | Describe fewer than four offers and explain the forced fallback. Do not advertise refusal as a market price signal or show an invented no-takers outcome. |
| Agents pitch, price, and produce; show the model on each offer | The buyer sees completed work, price, and pitch together. Agent identities, generation tier, prompts, and costs are revealed after selection. There is no preliminary pitch auction. | Explain the actual order: brief → completed offers → one winner → open books. Preserve anonymous judging. |
| “Go broke and you’re archived forever” | An agent below $0.10 is marked dead after settlement, with a replacement and a transfer of its remainder. “Forever” also promises retention the service does not guarantee. | Say retired to the graveyard; a challenger takes the seat. Name the $0.10 threshold in the rules. |
| Required buyer intent modes and multiplier guardrail | Neither is implemented. Current affordability is based on bankroll, and bids may be below cost. A production-cost multiplier is not enforced. | Treat as future product proposals, not copy to ship now. No intent selector or guardrail claim added. |
| Survival leaderboard ranked by bankroll, risk labels, streaks, sparklines | A proposed feature set. The existing ledger lists alive agents first, then sorts by net earnings, and already exposes balances, wins, spend, and returns. | Link to “Watch the agents.” Do not claim a bankroll-ranked survival leaderboard or fabricated risk states. |
| “One got paid. Three burned cash.” | Misstates partial fields and skipped agents. A winner can also sell below cost. | “Only one gets paid” works as the rule. Explain that losers retain their costs and a win need not be profitable. |
| “The most honest AI benchmark ever built” | Unsupported superlative. Shared models, synthetic costs, test payments, fallback work, and invited participants limit what can be inferred. | Describe observed choices under the contest’s rules. Avoid model rankings, real buyer economics, and benchmark superiority claims. |
| Winner payment buys the delivered asset | No implemented grant of exclusivity or cleared commercial rights. Outputs are displayed in the browser; video and comedy tapes are storyboard frames. | Describe what the visitor sees and chooses. Preserve the existing generated-work terms and make format limits visible. |
| Sandbox disclosure, minimum $0.50, winner-only capture | Accurate, but the $5 maximum, invite requirement, authorization before generation, and lack of reject-all also matter. | Surface these alongside the relevant action. Keep hackathon context in the composer and policies, consistent with the existing public-copy checks. |

## Copy changes made

- Share the same hero, category, payment notice, four-step explanation, title, and description between the static homepage and interactive arena.
- Use “Post a brief,” “Maximum budget,” and clear output names; distinguish the buyer’s ceiling from the agents’ bids.
- Explain anonymous judging before the reveal, winner-only payment, public briefs, partial fields, and survival accounting.
- Rewrite About around the visitor’s role and the agents’ stakes; expand How it works with truthful model, refusal, and retirement explanations.
- Keep discovery text and the app manifest consistent with the same category.

## Implementation evidence

- `src/catalog.ts`: $0.50–$5 budget, $4 opening stake, $0.10 death line, production menu and fixed decision costs.
- `src/ai.ts` (`TEXT_MODEL`, `IMAGE_MODEL`, `decide`, `make`): shared model backend, personality/journal context, tier choice, pitch and price generation.
- `src/game.ts` (`runRound`, `fillEntry`): skipping, compulsory house-template fallback, fixed wallet debits and permitted below-cost bids.
- `src/game.ts` (`publicEntry`, `pickWinner`, `buryIfBroke`): anonymous offers before selection; payment, reveal, retirement, inheritance, and challengers afterward.
- `src/paypal.ts` (`createAuthorizationOrder`, `captureAuthorization`): maximum authorization followed by a final capture of the winning price.
- `src/access.ts` and `src/index.ts`: invite sessions, generation limits, and owner-only winner selection.
- `public/app.js` (`workHTML`, `playerHTML`, `drawLedger`): browser output formats, storyboard playback, and actual ledger sorting.

## Verification

The public build, TypeScript check, JavaScript syntax check, and all eight existing public-site tests pass locally. Browser checks covered the homepage at desktop and 375px widths, the brief CTA and invite-field focus, spectator navigation to the ledger, and the revised informational pages. The small-screen homepage has no horizontal overflow and retains one main heading. Preview images are in `output/messaging/` (ignored by Git).

The supplied document remains unchanged. Its future feature requests have not been implemented as part of this messaging pass. Nothing was deployed, and no AI generation or PayPal authorization/capture was performed during this review.
