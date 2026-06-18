# 100xFenok Icon System — imagen Brief (FORGE #3)

> Author: Claude (cc-29) | Generator: Codex imagen2 | Gate: Claude (technical) + Owner (aesthetic pick)
> Date: 2026-06-13 | Source: owner feedback #3 (header brand mark inconsistent + "make it really beautiful, product-grade")

## Problem (verified)
The header brand mark differs per entry:
- V1 nav uses `/public/favicon-96x96.png` (`Navbar.tsx:277`)
- Shell / V2 / V3 use `/public/100x-fenok-logo.png` (`AppShell.tsx:231/285`, `NavbarV2.tsx:52`, `NavbarV3.tsx:60`)
That asset divergence is the "different per entry" the owner saw. Goal: ONE premium product mark used everywhere, plus a cohesive explore launcher-icon set.

## Brand context (for prompt grounding)
- Product: **100xFenok** — pro market-radar / financial-intelligence dashboard (전문 투자자용).
- Palette: deep navy **#010079** (primary), white; at most ONE accent (suggest an amber/gold `#E69F00` or electric cyan — pick one, keep restrained).
- Type system: Orbitron (display) + IBM Plex Sans KR.
- Tone: premium fintech, precise, motif of **radar sweep / scope aperture / upward 100x momentum**. NOT cartoonish. Must be color-blind-safe and crisp at 32px.
- Container today: white rounded square, radius ~10px, subtle border + shadow (`.rail-logo .mk`, `.hp-nav__mark`). Mark must read on a white tile.

## Deliverable 1 — Brand mark (generate NOW)
Direction candidates (generate 3–4 each, owner picks):
- (a) abstract radar sweep arc + upward tick
- (b) stylized **100×** monogram inside a rounded square
- (c) geometric scope/aperture mark with a rising element

Constraints: navy-dominant, ≤1 accent; legible at 32px; transparent-background PNG; balanced on a white rounded tile.

Output set (transparent PNG, square): `512` (master) → `192`, `96`, `32`; header mark `60`; apple-touch `180`; derive `favicon.ico` from the 32.
Replaces: `/public/100x-fenok-logo.png`, `/public/favicon-96x96.png`, `/public/favicon-32x32.png`, `/public/favicon-192x192.png`, `/public/favicon-512x512.png`, `/public/favicon.svg`.

## Deliverable 2 — Explore launcher icons (phase 2, after shortcuts defined)
Cohesive rounded-square app tiles for explore quick-launch (Mona-English style): shared corner radius, stroke weight, navy + single accent. Tiles map to explore shortcuts (TBD — e.g. Scouter, Valuation Lab, 3-Sec Brief, Mona English). Generate a starter set of 4–6 once shortcuts are confirmed. ~`120×120` transparent PNG each. May diverge from the brand mark stylistically (owner: "explore와 100x 메인이 달라도 됨").

## Flow
1. Codex imagen2 generates 3–4 brand-mark candidates per direction (Deliverable 1).
2. Claude gates: legibility at 32px, scaling cleanliness, white-tile contrast, palette compliance.
3. Owner picks the final mark (aesthetic authority — "최고로 이뿌게").
4. Export the size set → asset swap (in D) only after owner pick + Claude gate. No swap before that.

## Applied Follow-up — PWA launcher centering (2026-06-18)

- User feedback: Samsung/One UI installed icon no longer had the bad blue background, but the mark appeared shifted toward 11 o'clock.
- Active manifest icons moved from `pwa-icon-*-v3.png` to `pwa-icon-*-v4.png` to force Android/Chrome to fetch a new icon set instead of reusing an installed/cached launcher asset.
- `pwa-icon-512-v4.png` and `pwa-icon-maskable-512-v4.png` share the same centered foreground on `#f8fafc`; measured content center is `x=256.0`, `y=256.5` on a 512 canvas. `pwa-icon-192-v4.png` measures exactly `x=96.0`, `y=96.0`.
- App-shell and V2/V3 nav image CSS now pins `object-fit: contain` and `object-position: 50% 50%` so header logos cannot drift from container sizing.
