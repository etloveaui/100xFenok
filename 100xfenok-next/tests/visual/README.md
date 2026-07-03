# Visual QA Harness

This Playwright test-runner harness is the warn-only visual regression gate for
the main public routes. It is separate from the raw Chromium `.qa-playwright.js`
capture flow, which remains the smoke/crawl guard.

## Commands

```sh
npm run qa:visual
npm run qa:visual:update-baselines
```

The harness compares 9 routes across `desktop-1440` (1440x900) and `mobile-390`
(390x844). Baselines live under `qa-baselines/visual/v6/<project>/`.

Use `QA_BASE_URL=http://host:port npm run qa:visual` to run against an already
running server. Without `QA_BASE_URL`, Playwright starts `npm run start` on
`QA_VISUAL_PORT` or the default port `3107`.

Local macOS runs use `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
when it exists, avoiding a separate Playwright browser download. Override it with
`QA_CHROME_PATH=/path/to/chrome`.

## Determinism

- fixed browser clock: `2026-01-15T09:00:00.000Z`
- seeded `Math.random`
- light color scheme and reduced motion
- animation freeze stylesheet at capture time only
- optional HAR replay through `VRT_HAR_PATH` and `VRT_HAR_URL_GLOB`
- optional route skip list through `VRT_SKIP_ROUTES`
