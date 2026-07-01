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
the record must use a full ISO-8601 timestamp with timezone, match the current
local proof base URL, and keep `mutation_approved=false`. Use only one record
source per validation command: `--decision-record-json` or `--decision-record`.
To print the current owner record template, use `node
scripts/build-macro-owner-decision-packet.mjs --decision-record-template`. The
packet also exposes
`next_gated_slice` and `safe_enforcement_slices`; those slices are intentionally
no-mutation and must require a valid owner record before queue release. After a
valid owner record is supplied, the packet still selects only a decision-specific
no-mutation follow-up plan: preserve documentation, remap dry-run proposal, or
retire readiness packet. Redirect, delete, and deploy remain separate explicit
owner approvals. Rank 2 is exposed only as an inactive next-candidate preview;
it must stay `active=false` and no-mutation until rank 1 has both a valid owner
record and a recorded no-mutation follow-up. The inactive preview also carries
a prep-only local smoke matrix for the rank-2 owner route, compatibility route,
and legacy sample; that matrix is not rank release or live production proof.
The safe enforcement slices must also include
`rank2_pre_activation_local_smoke_prep`, which is still no-mutation and only
allows recording those inactive local smoke commands before rank-2 owner review.
To print the inactive rank-2 local smoke record skeleton, use `node
scripts/build-macro-owner-decision-packet.mjs --rank2-pre-activation-template`;
the skeleton must keep runtime status blank and `mutation_approved=false`. Rank-2
smoke commands are matched by exact local URL path, so `/market` and
`/market-valuation` stay distinct. To validate a filled rank-2 pre-activation
record without activating rank 2, call `node
scripts/build-macro-owner-decision-packet.mjs
--rank2-pre-activation-record-json=...` or use
`--rank2-pre-activation-record <file>`; the record must match the template rows,
report `local_runtime_smoke_passed`, keep every row `ok=true`, and keep
`mutation_approved=false`.
For the rank-1 follow-up gate after a valid owner decision record, use `node
scripts/build-macro-owner-decision-packet.mjs --decision-record-json=...
--decision-followup-record-template` to print the selected no-mutation follow-up
record skeleton, then validate a filled record with
`--decision-followup-record-json=...` or `--decision-followup-record <file>`.
The follow-up record still cannot request rank-2 release or mutation.
When the rank-1 owner decision record, rank-1 no-mutation follow-up record, and
rank-2 pre-activation smoke record are all valid, the packet exposes
`rank2_review_readiness=ready_for_rank2_owner_review_no_mutation`. That state is
review-only: `rank2_active=false`, `mutation_allowed=false`, and
delete/redirect/deploy remain blocked.
Only after that readiness state, `node
scripts/build-macro-owner-decision-packet.mjs --rank2-owner-review-template`
prints the rank-2 owner-review packet for `market_legacy_archive`. The template
contains preserve/remap/retire choices but remains review-only and no-mutation.
Use `--rank2-owner-decision-record-template` under the same readiness gate to
print the owner-review decision skeleton, then validate a filled record with
`--rank2-owner-decision-record-json=...` or
`--rank2-owner-decision-record <file>`. The record must keep
`rank2_active=false`, `mutation=none`, `mutation_approved=false`, and
delete/redirect/deploy blocked.
After a valid rank-2 owner decision record, use
`--rank2-owner-followup-record-template` to print the selected preserve/remap/retire
follow-up skeleton, then validate it with
`--rank2-owner-followup-record-json=...` or
`--rank2-owner-followup-record <file>`. The follow-up record must keep
`route_mutation_requested=false`, `deploy_requested=false`, and the same
blocked delete/redirect/deploy actions.
Only after that no-mutation follow-up validates,
`--rank2-mutation-approval-request-template` prints a request-only packet for
separate owner mutation approval. It keeps `approval_status=pending_owner_approval`,
`request_only=true`, `mutation_allowed=false`, and `execution_allowed=false`;
it still does not authorize redirect/delete/deploy.
`--rank2-mutation-approval-record-template` then prints the owner approval
record skeleton, but validation still requires `execution_allowed=false`,
`deploy_approved=false`, and `route_patch_applied=false`; execution remains a
future separate approval gate.
Even with a valid approval record, the packet keeps
`rank2_execution_readiness=blocked_pending_execution_prerequisites` until a
route/file diff proposal, rollback plan, local post-patch smoke plan, and
explicit deploy approval are recorded separately.
After a valid approval record, `--rank2-route-diff-proposal-template` prints a
draft-only route/file diff proposal skeleton. A supplied
`--rank2-route-diff-proposal-json=...` or `--rank2-route-diff-proposal <file>`
record may satisfy only the route/file diff prerequisite, while still requiring
`patch_applied=false`, `public_files_modified=false`,
`redirect_config_changed=false`, `delete_paths=[]`, `execution_allowed=false`,
and `deploy_approved=false`. Rollback, local post-patch smoke, and explicit
deploy approval remain separate blockers.
After a valid route/file diff proposal, `--rank2-rollback-plan-template` prints
a plan-only rollback skeleton. A supplied `--rank2-rollback-plan-json=...` or
`--rank2-rollback-plan <file>` record may satisfy only the rollback prerequisite,
while still requiring `rollback_scope=plan_only_no_execution`,
`patch_applied=false`, `rollback_applied=false`, `public_files_modified=false`,
`redirect_config_changed=false`, `delete_paths=[]`, `execution_allowed=false`,
and `deploy_approved=false`. Local post-patch smoke and explicit deploy
approval remain separate blockers.
After a valid rollback plan, `--rank2-local-post-patch-smoke-plan-template`
prints a plan-only local smoke skeleton for the owner route, compatibility
route, and legacy sample paths. A supplied
`--rank2-local-post-patch-smoke-plan-json=...` or
`--rank2-local-post-patch-smoke-plan <file>` record may satisfy only the local
post-patch smoke plan prerequisite, while keeping `smoke_scope=plan_only_no_runtime`,
`smoke_executed=false`, runtime statuses blank, `execution_allowed=false`, and
`deploy_approved=false`. Explicit deploy approval remains a separate blocker.
After a valid local smoke plan, `--rank2-explicit-deploy-approval-template`
prints a record-only approval skeleton. A supplied
`--rank2-explicit-deploy-approval-json=...` or
`--rank2-explicit-deploy-approval <file>` record may satisfy only the explicit
deploy approval prerequisite with `deploy_approved=true`, while still requiring
`deploy_executed=false`, `production_live_smoke_executed=false`,
`execution_allowed=false`, and a separate route execution packet before any
runtime action.
After all execution prerequisites are recorded, `--rank2-route-execution-packet-template`
prints the separate route execution packet as a record-only skeleton. A supplied
`--rank2-route-execution-packet-json=...` or
`--rank2-route-execution-packet <file>` record may satisfy only that packet
record with `execution_scope=record_only_no_runtime`, while keeping
`owner_runtime_release_status=not_recorded`, `route_patch_applied=false`,
`post_patch_smoke_executed=false`, `deploy_executed=false`, and
`production_live_smoke_executed=false`.
After a valid route execution packet, `--rank2-owner-runtime-release-template`
prints an owner runtime release record skeleton. A supplied
`--rank2-owner-runtime-release-json=...` or
`--rank2-owner-runtime-release <file>` record may satisfy only that release
record with `release_scope=record_only_before_runtime`, while keeping
`execution_allowed=false`, `route_patch_applied=false`,
`post_patch_smoke_executed=false`, `deploy_executed=false`, and
`production_live_smoke_executed=false`; the next runtime gate is
`route_patch_application_record`.
After a valid owner runtime release record,
`--rank2-route-patch-application-template` prints the route patch application
record skeleton. A supplied `--rank2-route-patch-application-json=...` or
`--rank2-route-patch-application <file>` record may satisfy only the local patch
application record with `patch_scope=record_only_local_patch_no_smoke_no_deploy`
and `route_patch_applied=true`, while keeping `post_patch_smoke_executed=false`,
`deploy_executed=false`, `production_live_smoke_executed=false`,
`public_files_modified=false`, `redirect_config_changed=false`, and
`delete_paths=[]`; the next runtime gate is `local_post_patch_smoke_record`.
After a valid route patch application record,
`--rank2-local-post-patch-smoke-record-template` prints the local post-patch
smoke record skeleton. A supplied
`--rank2-local-post-patch-smoke-record-json=...` or
`--rank2-local-post-patch-smoke-record <file>` record may satisfy only local
runtime smoke with `smoke_scope=local_runtime_only_no_deploy`,
`post_patch_smoke_executed=true`, and all smoke rows reporting the expected HTTP
status with `ok=true`, while keeping `deploy_executed=false`,
`production_live_smoke_executed=false`, `public_files_modified=false`,
`redirect_config_changed=false`, and `delete_paths=[]`; the next runtime gate is
`deploy_execution_record`.
After a valid local post-patch smoke record,
`--rank2-deploy-execution-template` prints the deploy execution record skeleton.
A supplied `--rank2-deploy-execution-json=...` or
`--rank2-deploy-execution <file>` record may satisfy only deploy execution with
`deploy_scope=record_only_deploy_no_live_smoke` and `deploy_executed=true`,
while keeping `production_live_smoke_executed=false`,
`public_files_modified=false`, `redirect_config_changed=false`, and
`delete_paths=[]`; the next runtime gate is `production_live_smoke_record`.
After a valid deploy execution record,
`--rank2-production-live-smoke-template` prints the production live smoke record
skeleton. A supplied `--rank2-production-live-smoke-json=...` or
`--rank2-production-live-smoke <file>` record may satisfy only production live
smoke with `smoke_scope=production_live_smoke_only_no_redirect_no_delete`,
`production_live_smoke_executed=true`, and all production smoke rows reporting
the expected HTTP status with `ok=true`, while keeping
`public_files_modified=false`, `redirect_config_changed=false`, and
`delete_paths=[]`; the next runtime gate is
`post_live_redirect_delete_approval_request`.
After a valid production live smoke record,
`--rank2-post-live-redirect-delete-approval-request-template` prints the
post-live redirect/delete approval request skeleton. A supplied
`--rank2-post-live-redirect-delete-approval-request-json=...` or
`--rank2-post-live-redirect-delete-approval-request <file>` record may satisfy
only the request step with
`request_scope=post_live_request_only_no_redirect_no_delete`,
`redirect_delete_approval_requested=true`, and
`redirect_delete_executed=false`, while keeping `public_files_modified=false`,
`redirect_config_changed=false`, and `delete_paths=[]`; the next runtime gate is
`post_live_redirect_delete_approval_record`.
After a valid post-live redirect/delete approval request record,
`--rank2-post-live-redirect-delete-approval-record-template` prints the owner
approval record skeleton. A supplied
`--rank2-post-live-redirect-delete-approval-record-json=...` or
`--rank2-post-live-redirect-delete-approval-record <file>` record may satisfy
only the owner approval step with
`approval_scope=record_only_no_redirect_no_delete`,
`redirect_delete_approved=true`, and `redirect_delete_executed=false`, while
keeping `public_files_modified=false`, `redirect_config_changed=false`, and
`delete_paths=[]`; the next runtime gate is
`post_live_redirect_delete_execution_packet`.
After a valid post-live redirect/delete owner approval record,
`--rank2-post-live-redirect-delete-execution-packet-template` prints the
execution packet skeleton. A supplied
`--rank2-post-live-redirect-delete-execution-packet-json=...` or
`--rank2-post-live-redirect-delete-execution-packet <file>` record may satisfy
only the execution-packet planning step with
`execution_scope=packet_only_no_redirect_no_delete`,
`redirect_delete_execution_planned=true`, and
`redirect_delete_executed=false`, while keeping `public_files_modified=false`,
`redirect_config_changed=false`, and `delete_paths=[]`; the next runtime gate is
`post_live_redirect_delete_execution_record`.
After a valid post-live redirect/delete execution packet record,
`--rank2-post-live-redirect-delete-execution-record-template` prints the
execution evidence record skeleton. A supplied
`--rank2-post-live-redirect-delete-execution-record-json=...` or
`--rank2-post-live-redirect-delete-execution-record <file>` record may satisfy
only the externally performed execution evidence step with
`execution_scope=record_only_redirect_delete_execution_evidence`,
`redirect_delete_executed=true`, and
`execution_performed_by_this_command=false`; it must also keep
`local_files_modified_by_this_command=false` and then moves the next runtime
gate to `post_live_redirect_delete_post_execution_smoke_record`.
After a valid post-live redirect/delete execution record,
`--rank2-post-live-redirect-delete-post-execution-smoke-template` prints the
post-execution smoke evidence skeleton. A supplied
`--rank2-post-live-redirect-delete-post-execution-smoke-json=...` or
`--rank2-post-live-redirect-delete-post-execution-smoke <file>` record may
satisfy only externally performed post-execution smoke evidence with
`smoke_scope=post_execution_smoke_only_no_additional_redirect_delete_no_deploy`,
all rows `ok=true` with an allowed HTTP status, and
`smoke_performed_by_this_command=false`; the next runtime gate is
`post_live_redirect_delete_rollback_readiness_record`.
After a valid post-execution smoke record,
`--rank2-post-live-redirect-delete-rollback-readiness-template` prints the
rollback readiness evidence skeleton. A supplied
`--rank2-post-live-redirect-delete-rollback-readiness-json=...` or
`--rank2-post-live-redirect-delete-rollback-readiness <file>` record may satisfy
only rollback readiness with
`rollback_scope=record_only_rollback_readiness_no_rollback_no_deploy`,
`rollback_ready=true`, `rollback_applied=false`, and
`rollback_performed_by_this_command=false`; the next runtime gate is
`post_live_redirect_delete_owner_closeout_record`.

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
