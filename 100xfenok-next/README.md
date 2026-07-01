This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Local QA

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
mobile primary IA. The current rank-1 macro-monitor slice also reports legacy
bridge smoke paths and source entrypoint evidence so Home/dashboard links can be
compared with the native `/macro-chart` owner route before any preserve, remap,
or retire decision. Its live-equivalence prep matrix is still no-network
inventory output, but it lists the required local smoke rows for `/macro-chart`,
`/admin/macro-monitor`, three direct legacy samples, and their three Radar
bridge URLs. The queue must not advance past rank 1 until that owner decision is
recorded; rank 2 is reported only as the next candidate after the rank-1 gate is
released.

Run `npm run qa:route-iframe-contract` only against a local Next.js server. It
defaults to `http://127.0.0.1:3105` and checks the route-backed iframe catalog:
route HTML must expose the expected iframe `src`, and that iframe asset must
serve with `?embed=1`. Non-local `QA_BASE_URL` values are refused by default;
set `QA_ROUTE_IFRAME_ALLOW_REMOTE=1` only for an explicitly approved live smoke.

Run `npm run qa:macro-owner-live-equivalence` only against a local Next.js
server. It defaults to `http://127.0.0.1:3105`, reads the rank-1 macro-monitor
matrix from `qa:canonical-root-inventory`, then smokes `/macro-chart`,
`/admin/macro-monitor`, three direct legacy samples, and their three Radar
bridge URLs. Non-local `QA_BASE_URL` values are refused by default; set
`QA_MACRO_OWNER_ALLOW_REMOTE=1` only for an explicitly approved live smoke.

Run `npm run qa:macro-owner-decision-packet` before asking the owner to choose
preserve, remap, or retire for the rank-1 macro-monitor slice. It composes the
canonical-root inventory and local live-equivalence proof into a no-mutation
decision packet, keeps redirect/delete/deploy blocked, and leaves rank 2 queued
until the owner decision is explicit. To validate a supplied owner record, call
`node scripts/build-macro-owner-decision-packet.mjs --decision-record-json=...`;
the record must keep `mutation_approved=false`. To print the current owner
record template, use `node scripts/build-macro-owner-decision-packet.mjs
--decision-record-template`. The packet also exposes
`next_gated_slice` and `safe_enforcement_slices`; those slices are intentionally
no-mutation and must require a valid owner record before queue release.

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

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
