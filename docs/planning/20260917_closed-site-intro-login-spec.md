# Closed site, intro face and Google login — spec v0.1 (2026-09-17)

> Owner decisions captured 2026-09-17 in window 2. Build order is face-first: the intro and real
> Google login ship as slice 1 while the site stays open; the gate flips in slice 3.

## 0. Owner decisions (verbatim intent, 2026-09-17)

- 100x becomes a closed site: login is the first thing every visitor meets.
- Any Google account may log in. No allow-list. The owner must be able to see who is viewing.
- Personalization must cover the portfolio first; already-personal surfaces (IB) connect by
  adopt-once then sync.
- The first page is a cinematic, animated intro in today's style, dark is allowed, with skip → login.
- Reference faces may be copied properly. Design changes go branch → apply → verify → deploy
  without a mock-up approval gate (owner feedback 2026-09-16).

## 1. Reference harvest (measured 2026-09-17, desktop 1440)

Captures: `scratchpad/ref/*-hero.png`, `*-thumb.png` (session scratchpad); HTML fetched with curl.

| Site | Hero construction | Motion source | Weight |
|---|---|---|---|
| TradingView | full-bleed dark, earth + aurora, 64px+ centered headline, one white pill CTA, one-line caption | looping video | 5.0–5.4 MB webm/mp4 |
| Robinhood | dark, device-specific loops (mobile 1080×1950, tablet 1152×1350, wide 2560×1080) | video | 0.6–1.6 MB per device |
| Raycast | dark, floating pill nav, diagonal red light streaks, centered 64px headline, small CTA | SVG/radial gradients + one cube shader | no video |
| Linear | #08090a, headline left, product UI fades in below | 75 CSS keyframes, 300 animation props | no video |
| Framer | dark, product video in rounded frame with glow | video | 0.8–3.8 MB |
| Public | light, serif headline, film still | video | — |
| Vercel | white, minimal, one WebGL glow | WebGL | — |

Take-aways applied below: one headline, one CTA, dark neutral base with a single accent, motion
either from a ≤1.6 MB device-specific loop or procedural layers; nothing above the fold that is not
the face itself. Coinbase could not be fetched (403).

## 2. Intro face ("100x Intro")

Dark base `#08090a` (Linear/Raycast), single accent = existing cp accent token, up/down semantic
colors only inside data layers. Light theme remains the product default; the intro is the one
sanctioned dark surface.

Layers, back to front:

1. **Light streaks** — 3–4 diagonal soft streaks in accent hue, slow drift (Raycast construction,
   CSS gradients + blur; no shader in slice 1).
2. **Market field (live data)** — procedural, drawn from the same JSON the home screen already
   loads. **US-first (owner 2026-09-17: 주력은 미국)**: S&P 500 and Nasdaq sparklines drawing
   themselves, the 11 US sector breadth bars rising in sequence, US sector-rotation dots settling
   into quadrants. KOSPI is at most one small secondary tile, never a headline series. Every visit
   shows today's numbers.
3. **Headline** — one Korean line, one caption line; copy follows criteria v0.2 (no hype).
4. **Login card** — Google button (GIS `renderButton`, pill, `continue_with`) + ghost
   "둘러보기" (skip). Card rises at 3.5 s; skip is visible from 0 s.

Timeline: 0–0.8 s logo + streaks · 0.8–3.5 s data draws · 3.5 s card rises · 6 s card takes focus.
`prefers-reduced-motion`: final composition rendered statically, card visible at 0 s.
Returning device with a valid session: intro is skipped entirely (setting "인트로 다시 보기").

Preview policy (owner question 2026-09-17): slice 1 ships to the live host at `/intro` with no
redirect and no gate, so the live route itself is the preview; no second Worker. Workers version
preview URLs are NOT available here: Cloudflare docs state preview URLs are not generated for
Workers that implement a Durable Object (verified 2026-09-17,
developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/), and 100x already
exports two. For the slice-3 gate flip use a canary mode instead: `CLOSED_SITE=preview` applies the
gate only to requests carrying an owner-set `fx_preview=1` cookie, so the owner walks the closed
experience on the live host while everyone else is unaffected; `CLOSED_SITE=1` then flips it for all.

Responsive: 390 stacks (sparkline full-width, bars in two rows, card bottom-sheet); ≥1024 splits
headline/card left and market field right. PWA standalone uses the button flow, never One Tap.

Performance gates (felt, measured on device): first paint ≤ 1.0 s on 4G phone, 60 fps animation,
skip tap → route change ≤ 100 ms. Data budget ≤ 60 KB: reuse existing computed files when they fit,
else add one derived `intro-feed.json` to the manifest projection. Video is not in slice 1; if the
procedural field is judged not cinematic enough, add one ≤1.6 MB device-specific loop served from
R2, never from bundled public assets (14,740 of 20,000 files used).

## 3. Login port (winddown → 100x)

Source: `claude-code-hub/docs/products/mona-english/{worker,web}` (guide: outbox
`winddown-login-system-guide`). Verification logic and DO storage port as-is; wiring changes:

| Winddown | 100x |
|---|---|
| `worker/src/index.ts` routes | Next route handlers `src/app/api/auth/google`, `api/auth/logout`, `api/user/me` |
| `UserStore` DO, migration v5 | same class exported from `worker.ts`, new migration tag `v3-user-store`, binding `USER_STORE` |
| `VITE_GOOGLE_CLIENT_ID` | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (public value; same client as winddown: `435404551214-…`) |
| `GOOGLE_CLIENT_ID` | wrangler var (public) |
| `ALLOWED_EMAILS` | dropped; open registration. `BLOCKED_EMAILS` lives in the registry (slice 2) |
| localStorage bearer only | HttpOnly cookie `fx_session` (Secure, SameSite=Lax, 30 d, refresh at 15 d) **plus** Bearer for API clients |
| `App.tsx` header button | `AppShell` topbar: photo/initial pill next to the freshness pill; tap → logout confirm |

Secrets go in with `wrangler secret put` only. Admin session stays separate in slice 1; merging
admin into "owner role" is a slice-2 decision.

## 4. Who is viewing (slice 2)

- `UserRegistry` DO (single instance): `{sub, email, name, picture, firstSeen, lastSeen,
  loginCount, devices}` upserted on every `/api/auth/google`.
- Heartbeat `POST /api/user/ping` every 60 s while the tab is visible → `lastSeen`; "지금 보는 중" =
  lastSeen within 5 min.
- `/admin/users`: now / today / 7 d / total, per-user row, top routes, block (deny list), revoke all
  devices. Existing admin gate.
- First login of a new person → one-line Telegram notice through the existing alarm path
  [not verified which pipe; resolve in slice 2].

## 5. Closed-site gate (slice 3)

- Flag `CLOSED_SITE=1` (wrangler var). Off = today's behavior; on = gate below. Rollback = flag off.
- Page requests: Next middleware verifies `fx_session` (WebCrypto HMAC like the admin session) and
  redirects unauthenticated requests to `/intro?next=<path>`.
- Data and API: `worker.ts` denies `/data/*` and `/api/data/*` without cookie, Bearer, or service
  token, before the asset worker, so bundled JSON is not reachable anonymously.
- Always open: `/intro`, `/api/auth/*`, `/_next/static/*`, favicon/manifest/robots, `/api/health`
  if present.
- Service token: header `x-fenok-verify: <HMAC(date)>`, secret `VERIFY_TOKEN` in GitHub secrets;
  hosted checks that read the live host (Deploy Worker provenance readback, QA Visual, journey
  runs, live smoke, alarm probes) send it. **Pre-step: inventory every workflow and external
  reader (Asset_Allocator, CCH) that hits the live host**; the flag does not flip until each has
  the header or a documented exemption.

Inventory result (lead, 2026-09-17, grep over workflows, repo scripts and sibling projects):

| Reader class | Members | Gate treatment |
|---|---|---|
| Internal data-plane door `/internal/cloud-data-plane` | 28 workflows (all fetch-*, slickcharts-*, update-manifest, coordinate-computed-signals, rehearsals, shadow publishes) | already authenticated by `x-data-plane-key`; stays exempt from the session gate, handled before the app |
| Live page/provenance readers of `/` | deploy-worker provenance readback, qa-visual (QA_BASE_URL), check-sec13f-live-parity, slickcharts-symbols/weekly, scripts check-live-deploy-provenance / check-deploy-source-fence / check-cloud-family-acceptance / test-sec13f-live-privacy / smoke-stockanalysis-routes / check-seo-surface / build-macro-owner-decision-packet | must send `x-fenok-verify`; add the header at one shared place (env passed to the scripts) |
| Data-plane serving probe of enrolled `/data/*` paths | scripts/ops/probe-data-plane-serving (six-hourly), global-scouter-rollback-rehearsal (`/data/global-scouter/etfs/index.json`) | must send `x-fenok-verify` |
| API smokes | check-quote-contract and test_data_spine_gas_quote_gateway (`/api/ticker/`) | must send `x-fenok-verify` |
| SEO surface | robots.ts / sitemap.xml | keep open (or drop sitemap once closed; owner call) |
| External agent skills reading `/data/` | claude-code-hub feno-data-remote, feno-value datapack/config | need the token from env (`FENOK_VERIFY_TOKEN`) or they lose live reads; local JSON path unaffected |

**Implementation notes**: Environment configuration uses `CLOSED_SITE` (wrangler var: `off` [default], `preview`, or `on` [aliases `1`, `true`]) and `FENOK_VERIFY_TOKEN` (service token secret for HMAC-SHA256 UTC date signatures in `x-fenok-verify`). Flip procedure: ship the gate code with `CLOSED_SITE=off` (zero behavior change). When ready to canary, set `CLOSED_SITE=preview` in Cloudflare wrangler vars; the owner sets cookie `fx_preview=1` in browser and walks the closed site on the live host (`https://100xfenok.etloveaui.workers.dev`) while ordinary visitors remain unaffected. After confirming the gate flow and login on live devices, update `CLOSED_SITE=on` to enforce the gate globally for all visitors, with instant rollback to `off` if any unexpected issue occurs.

## 6. Personal store (slice 4)

One `personalStore` layer over the five browser-stored families: portfolio, watchlist, IB profiles
+ daily, macro-chart presets, (changes last-visit stays device-local). Rules: on login, if the
device has data and the account is empty → upload silently; if both → ask once "이 기기 것 가져올까요?";
afterwards write-through to the account, read server first, browser copy is cache. IB keeps its
profile IDs one level under the account ID.

## 7. Slices and ownership

| Slice | Content | Owner |
|---|---|---|
| S1 | intro face + real Google login + skip; site still open | right pane implements on `feat/intro-login` (isolated worktree); lead reviews, lands, deploys |
| S2 | registry, heartbeat, `/admin/users`, first-login notice | right pane |
| S3 | flag, middleware + worker gate, service token, hosted-check wiring, reader inventory, flip | lead writes gate + inventory; right pane wires checks |
| S4 | personal store + adopt-on-login | right pane |

Verification per slice: hosted contracts + Deploy Worker + live readback as usual; a real login
round-trip is an owner/guest-window check on a device and stays `[not verified]` until done. The
intro's felt gates are measured on device, not by bytes.

## 8. Owner actions

1. Google Cloud console: add the 100x origin (`https://100xfenok.etloveaui.workers.dev`) to the
   existing OAuth client's authorized JavaScript origins.
2. Publish the consent screen to production (profile/email scopes only; no review needed).
3. Later: custom domain decision (also unlocks the Cloudflare Access alternative, not pursued now).
