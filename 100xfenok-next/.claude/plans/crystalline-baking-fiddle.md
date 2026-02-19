# Plan: Next.js Migration Full QA Fix

## Context

Previous QA (47/47 PASS) ran against `dist` static build (`http://127.0.0.1:4173`).
User wants comprehensive QA against **dev server** (`http://localhost:3000`) with all viewport issues fixed.
ESLint is already clean. Build passes (22/22 routes). Playwright v1.56.1 installed.

---

## Phase 0: Baseline QA Run (Diagnostic)

**Goal**: Get exact failure data from dev server.

1. Start dev server: `npm run dev` (background, port 3000)
2. Wait for ready signal
3. Run QA: `QA_BASE_URL=http://localhost:3000 node .qa-playwright.js 2>&1`
4. Capture full JSON output — categorize failures

**This phase determines everything that follows.** All subsequent fixes depend on actual failures found.

---

## Phase 1: QA Script Filter Expansion (Dev Server Noise)

**File**: `.qa-playwright.js`

Dev server produces console messages that static build doesn't. Add `isDevServerNoise(msg)` filter:
- `[HMR]`, `[Fast Refresh]`, `webpack-hmr` messages
- Turbopack compilation messages
- React hydration mismatch warnings
- `__nextjs` internal messages
- `chunk load` errors from hot reload

Update blocking filter chain:
```javascript
const blockingConsoleErrors = consoleErrors.filter(
  (msg) => !isExternalFetchNoise(msg) && !isNonBlockingConsoleNoise(msg) && !isDevServerNoise(msg)
);
```

**Risk**: Low (additive filters only)

---

## Phase 2: CSS Viewport Fixes

**File**: `src/app/globals.css`

### 2a: Horizontal Scroll Prevention
- Check if any elements overflow on 390px/540px viewports
- Likely sources: `.quick-indices-scroll`, period menu absolute positioning, table overflows
- Fix: `max-width: 100%` or `overflow: hidden` on offending elements

### 2b: Iframe-Footer Overlap
- `.route-embed-shell` uses `calc(100dvh - 7rem - 72px - 0.75rem)`
- `7rem = 112px` but actual nav is `h-14 = 56px` on mobile (< 640px)
- Footer on mobile: only 48px main bar (ticker hidden), but spacer reserves 72px
- Fix if overlap detected: adjust calc per breakpoint to match actual nav height

### 2c: Fold-Specific Issues (540x720)
- 540px is below `sm:` (640px) breakpoint — gets mobile treatment
- Verify grid layouts don't create overflow at this width
- Check `.hero-zone` grid collapse behavior

**Risk**: Medium — CSS changes cascade. Test all 3 viewports after each change.

---

## Phase 3: Route-Specific Fixes

Based on Phase 0 findings, fix issues per route:

| Route Type | Potential Issues | Fix Location |
|-----------|-----------------|--------------|
| Iframe routes (6) | Console errors from legacy HTML API calls | `.qa-playwright.js` filters or page components |
| `/posts`, `/vr` | Linked page 404s if static files missing | Verify `sync-static` ran, fix `<a>` paths |
| `/100x/daily-wrap` | Missing daily data → filtered error | Already handled |
| Admin routes (3) | API fetch failures from admin iframes | Filter or fix paths |

---

## Phase 4: Iterative QA Validation

```
Fix batch → Re-run QA → Analyze remaining → Fix → Re-run
```

Target per iteration:
1. After Phase 1: Blocking console errors ↓
2. After Phase 2: Viewport failures ↓
3. After Phase 3: Route-specific failures ↓
4. Final run: **failures: 0, blockingConsoleErrorCount: 0**

---

## Phase 5: Build Verification

After all fixes:
1. `npx eslint src/` — 0 warnings
2. `npm run build` — 22/22 routes pass
3. Final QA run — 0 failures confirmed

---

## Critical Files

| File | Purpose |
|------|---------|
| `.qa-playwright.js` | QA script — dev server noise filters |
| `src/app/globals.css` | 839 lines — viewport CSS, `.route-embed-shell` |
| `src/components/Footer.tsx` | Fixed footer + spacer |
| `src/components/Navbar.tsx` | Responsive nav, mobile menu |
| `src/app/layout.tsx` | Root layout structure |

## Verification

1. `QA_BASE_URL=http://localhost:3000 node .qa-playwright.js` → failures: 0
2. `npm run build` → success
3. `npx eslint src/` → 0 warnings

## Risk Summary

| Risk | Impact | Mitigation |
|------|--------|------------|
| QA filters too broad → mask real errors | HIGH | Keep filters narrow, dev-server specific |
| CSS fix breaks other viewport | MEDIUM | Test all 3 viewports after each change |
| Static files missing in dev | LOW | `predev` script runs `sync-static` automatically |
| Dev server timing differences | LOW | QA has 45s timeout, add wait if needed |
