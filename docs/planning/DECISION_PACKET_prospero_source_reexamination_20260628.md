# DECISION PACKET: ProsperoAI Source Re-examination

Date: 2026-06-28 KST
Status: research-only decision packet
Scope: #324 ProsperoAI source viability vs Fenok-native signal methodology

## Executive Verdict

Recommendation: **NO-GO for using, scraping, republishing, or publicly surfacing
real ProsperoAI app/newsletter/community signals on 100xFenok without written
permission or a clear API/license agreement.**

The safe path is to keep **Fenok-native** as the product answer: independently
implemented, auditable derived signals from our own approved data contracts,
with no Prospero raw scores, picks, model output, screenshots, app payloads,
newsletter payloads, or community payloads.

Allowed:

- Link out to official Prospero public pages.
- Cite the public product taxonomy in minimal, attributed form.
- Use the high-level idea of multi-axis stock signals as inspiration.
- Build independent Fenok-derived signals from approved/free sources.
- Revisit only if Prospero grants written redistribution/API rights.

Blocked:

- Raw Prospero scores/picks.
- App scraping or screenshot-derived data extraction.
- Paid/free newsletter copying beyond small attributed quotation.
- Discord/community scraping or reuse without consent.
- Attribution-only republication.

## 1. What ProsperoAI Actually Is

Official product shape:

- ProsperoAI is a free iOS/Android investing app focused on AI stock picking,
  stock signals, watchlists, screeners, and educational guidance.
- Official site positions the app as turning institutional/market data into
  actionable signals for retail investors.
- App Store metadata confirms the app is distributed by `PROSPERO.AI LLC`,
  categorized as Finance, and priced at `0.00 USD`.
- Official support says the app is free while newsletters can have free and
  premium Substack tiers.

Official signal taxonomy observed on the public learning center:

- Long-term: Upside Breakout, Downside Breakout, Profitability, Market
  Similarity, Growth.
- Short-term: Net Options Sentiment, Net Social Sentiment, Net Institutional
  Sentiment, Dark Pool Rating, Short-Pressure Rating.

This is materially close to the methodology the owner wanted absorbed: not a
single buy/sell score, but a multi-signal lens that separates long-term quality,
growth, market similarity, upside/downside, and shorter-term flow/sentiment
pressure.

Official evidence:

- Prospero home: `https://www.prospero.ai/`
- Prospero app page: `https://www.prospero.ai/app`
- Prospero learning center: `https://www.prospero.ai/resources/learning-center`
- Apple App Store: `https://apps.apple.com/us/app/prospero-ai-ai-stock-trading/id1529837512`
- Apple lookup API: `https://itunes.apple.com/lookup?id=1529837512&country=us`
- Prospero support billing article:
  `https://support.prospero.ai/support/solutions/articles/154000158302-cancelling-your-newsletter-subscription`

Short source snippets, accessed 2026-06-28 KST:

- Prospero app page: "Proprietary Stock Signals & Alerts"
- Prospero learning center: "Long-Term Signals" and "Short-Term Signals"
- Apple surfaces: `price: 0.00`, `formattedPrice: Free`, `hasInAppPurchases: false`
- Prospero support: "app is now, and will always be, free to use"

## 2. ToS / Redistribution Re-examination

Prospero-specific Terms page:

- Official URL exists: `https://www.prospero.ai/terms`
- The page is a Webflow page embedding Termly policy ID
  `e3c55a92-0f96-45b3-871f-a9a562ab661b`.
- The visible HTML contains the Termly embed but not the operative policy text.
- Termly iframe/API attempts returned `Policy Not Found` or `404` for the
  embedded ID during this review.

Implication: there is no verified Prospero-specific permission grant that would
allow 100xFenok to reuse, derive from, scrape, republish, or publicly display
Prospero app/newsletter/community outputs.

Because the product itself is described as proprietary, and because no readable
license/API grant was found, the default decision must be restrictive. For a
public 100xFenok platform, "not forbidden in visible text" is not enough. We need
affirmative written permission or a published API/license.

Channel-specific terms:

- Substack hosts Prospero newsletter content. Substack terms say creators own
  their posts, restrict copying non-owned content without consent, and prohibit
  scraping/copying significant content.
- Discord is linked as a Prospero community channel. Discord terms require
  consent for other users' content and retain restrictions on Discord software
  and services.

Short source snippets, accessed 2026-06-28 KST:

- Substack ToS: "Crawls, scrapes, or spiders"
- Substack ToS: "Copies or stores any significant portion"
- Discord ToS: "You may not use this content without that person's consent"

Decision by use case:

- Real app signals/picks: **NO-GO** unless written permission/API/license.
- App reverse engineering or scraping: **NO-GO**.
- Newsletter signals/picks: **NO-GO** for republication; link/minimal quote only.
- Discord/community ideas: **NO-GO** for scraping; consent required.
- Public official taxonomy: **OK** as small attributed references.
- Fenok-derived lookalike methodology: **OK** if independently computed from
  our approved sources and clearly labeled as Fenok-derived.

## 3. Access, Pricing, and API

Verified:

- iOS app price is free via Apple lookup (`price: 0.00`).
- App Store page says free and the Apple product payload reports no in-app
  purchases in the observed page payload.
- Prospero support says the app is free and newsletters have free/premium
  Substack versions.

Not verified:

- No public Prospero API was found.
- No developer documentation was found.
- No bulk export, redistribution, partnership, or public data license was found.
- Premium newsletter pricing was not captured as a stable official price in this
  packet; Substack manages the subscription surface.

Free-first conclusion:

- The app itself being free does **not** create public data rights.
- A free mobile UI is not a free data API.
- Paid newsletter access would still not grant republication rights.
- Any compliant real-source path likely requires direct Prospero permission,
  contract, or a future published API/license.

## 4. Incremental Value vs Shipped Fenok-native Proxy

Current Fenok-native baseline:

- `CONTRACT_fenok_native_signals_v0_1_20260628.md` states that
  `fenok_signals.json` absorbs Prospero-like methodology into Fenok-native,
  auditable signals without copying third-party scores or collecting new
  external data (`docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md:9`).
- Inputs are limited to existing Fenok-generated fields and no external
  collection is performed (`docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md:18`).
- Public payload rule is derived scores only; full signal artifact is private,
  public artifact is a compact summary, and no raw third-party rows are shipped
  (`docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md:28`).
- Signals implemented: profitability, growth, technical_flow, upside_downside,
  market_similarity (`docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md:151`).
- Summary coverage observed: 1,066 rows; 1,011 high confidence, 37 medium, 18
  low; public surface status is `phase_a_stock_signal_lens_approved_summary_public`.

Shipped product surfaces:

- `/stock/[ticker]` exposes five Fenok signal chips:
  `100xfenok-next/src/app/stock/[ticker]/FenokSignalLensCard.tsx:21`.
- `/screener` joins Fenok signal summary and maps `upsideDownsideScore` into
  `fenokEdgeScore`:
  `100xfenok-next/src/hooks/useScreenerData.ts:91` and
  `100xfenok-next/src/hooks/useScreenerData.ts:166`.
- Superinvestor factor radar ships derived Fama-French factor tilt only, with
  raw factor data kept private:
  `scripts/build-13f-factor-radar-v2.mjs:371` and
  `100xfenok-next/src/app/superinvestors/PortfolioCharts.tsx:1182`.

What real Prospero appears to add beyond Fenok-native:

- Net Options Sentiment.
- Net Social Sentiment.
- Net Institutional Sentiment as a proprietary presentation.
- Dark Pool Rating.
- Short-Pressure Rating.
- App-native alerts and watchlist workflows.
- Educational copy and UX around how to interpret those signals.

What Fenok-native already covers reasonably:

- Profitability.
- Growth.
- Upside/downside proxy.
- Market similarity.
- Price/technical flow proxy.
- SEC 13F/superinvestor analytics.
- Derived factor exposure radar.
- Public/private data boundary discipline.

Important gap:

Fenok-native explicitly does **not** claim true order flow, true options flow,
dark-pool intent, borrow fee/utilization, social firehose, or true short
pressure (`docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md:173`
and `docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md:197`).

Therefore Prospero's incremental value is mainly:

1. A useful taxonomy for future Fenok signal design.
2. A benchmark for UX language and signal grouping.
3. A reminder that our missing flow/sentiment signals need source contracts.

It is **not** currently a viable public data source.

## 5. Go / No-Go Recommendation

Decision: **NO-GO for real Prospero source integration.**

Reason:

- No public Prospero API/license found.
- Prospero-specific Terms text was not accessible enough to verify a grant.
- Product surface is proprietary.
- Substack/Discord channels add explicit scraping/copying/consent constraints.
- App Store/free pricing proves distribution, not data rights.
- Our shipped Fenok-native path already captures much of the methodology safely.

Compliant path if owner still wants Prospero proximity:

1. Keep current Fenok-native signals as the public product answer.
2. Rename/position internal roadmap as "Prospero-like taxonomy absorption",
   never "Prospero data integration".
3. Add future Fenok-native source contracts for missing short-term axes:
   options proxy, social/news proxy, FINRA short-pressure proxy, ATS/off-exchange
   proxy, and SEC/13F institutional proxy.
4. Use only free, official, machine-accessible sources after owner review.
5. If real Prospero source is still desired, contact Prospero for a written
   public redistribution/API/license grant before any implementation.

Public wording guard:

- Good: "Fenok-derived signal lens inspired by multi-factor investing workflows."
- Good: "No third-party raw scores or Prospero outputs are used."
- Bad: "Powered by ProsperoAI."
- Bad: "Prospero signals inside 100xFenok."
- Bad: "Dark pool/option/social intent" unless the underlying approved source
  contract actually supports that claim.

## Evidence Log

Local baseline:

- `docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md:9`
- `docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md:18`
- `docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md:28`
- `docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md:151`
- `docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md:173`
- `docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md:197`
- `scripts/build-fenok-signals.mjs:600`
- `100xfenok-next/src/app/stock/[ticker]/FenokSignalLensCard.tsx:21`
- `100xfenok-next/src/hooks/useScreenerData.ts:91`
- `100xfenok-next/src/hooks/useScreenerData.ts:166`
- `scripts/build-13f-factor-radar-v2.mjs:371`
- `100xfenok-next/src/app/superinvestors/PortfolioCharts.tsx:1182`

External official sources:

- `https://www.prospero.ai/`
- `https://www.prospero.ai/app`
- `https://www.prospero.ai/resources/learning-center`
- `https://www.prospero.ai/terms`
- `https://www.prospero.ai/privacy-policy`
- `https://apps.apple.com/us/app/prospero-ai-ai-stock-trading/id1529837512`
- `https://itunes.apple.com/lookup?id=1529837512&country=us`
- `https://support.prospero.ai/support/solutions/articles/154000158302-cancelling-your-newsletter-subscription`
- `https://substack.com/tos`
- `https://discord.com/terms`

Checks performed:

- Read official Prospero Webflow pages via `curl`.
- Read Apple App Store page and Apple lookup JSON.
- Read Prospero support Freshdesk article.
- Read Substack and Discord terms pages.
- Attempted Termly policy content retrieval for Prospero Terms/Privacy embed IDs.
- Read local Fenok-native contract, builder, public stock card, screener join,
  and factor-radar boundary implementation.

No Playwright/browser automation was run.
