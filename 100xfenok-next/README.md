This is the Next.js application for 100x Fenok. Canonical production deploys
to Cloudflare Workers via OpenNext.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see
the result.

## Local QA

### EDGAR translation contract ordering

`data/edgar-korean-summaries/` is canonical-only in Git. The public mirror under
`public/data/edgar-korean-summaries/` is generated materialization, so
`qa:edgar-translations` requires the mirror to exist. For a local check, materialize
first, then run the translation contract:

```bash
node scripts/sync-public-data.mjs --write
npm run qa:edgar-translations
```

The EDGAR producer workflow writes the canonical and generated roots before its
translation contract check.

Run `npm run qa:canonical-root-inventory` before any #296 canonical-root
redirect, legacy delete, or deploy proposal. It is static and makes no network
or runtime mutation. The report also checks route-backed iframe catalog drift:
catalog routes, unique public HTML targets, missing assets, shared targets, and
low-risk helper retirement readiness. A readiness row never authorizes deletion;
its owner-approval packet records non-mutating pre-approval commands, proposed
scope, soak, and rollback fields for review. High-risk legacy HTML rows are
also grouped into owner-route families so PRO IA review starts from the owning
screen instead of a raw file-delete list. Each high-risk family also carries an
owner-route equivalence packet with local smoke commands before any mutation can
be requested, plus a deterministic owner-review queue that names the next gated
family slice. Each queued packet also carries structured PRO screen-model
acceptance, so canonical-root cleanup must preserve Home as search-first, keep
dedicated depth owners, leave Workbench secondary, and keep legacy HTML out of
mobile primary IA. The R4 retirement removes only the #296 decision-packet
generator and local macro live-equivalence runner. Existing macro pages and the
canonical-root inventory remain unchanged.

Run `npm run qa:route-iframe-contract` only against a local Next.js server. It
defaults to `http://127.0.0.1:3105` and checks the route-backed iframe catalog:
route HTML must expose the expected iframe `src`, and that iframe asset must
serve with `?embed=1`. Non-local `QA_BASE_URL` values are refused by default;
set `QA_ROUTE_IFRAME_ALLOW_REMOTE=1` only for an explicitly approved live smoke.

Run `npm run qa:routes` after route/key, AppShell IA, or Home/Workbench owner
changes. It includes the PRO route IA contract: home stays the primary
search-first entry, Workbench stays secondary, and mobile primary tabs stay
`홈 / 시장 / 스크리너 / 포트폴리오 / 더보기`.

Run `npm run qa:macro-chart` for the macro-chart/Explore connected-surface
contract. When bundled Playwright browsers are unavailable, pass local Chrome
with `QA_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

## Deploy on Cloudflare Workers

Use `npm run cf:build` for the guarded OpenNext build and `npm run cf:deploy`
only after explicit deployment approval.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
