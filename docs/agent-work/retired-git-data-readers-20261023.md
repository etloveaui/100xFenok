# Retired Git data reader audit — 2026-10-23

Scope: `.github/workflows`, `scripts`, and `100xfenok-next/scripts` in the product checkout. Followed current workflow calls, npm aliases, imported readers and the existing SEC 13F runner. Baseline HEAD: `784dde4efad283054d4d6c508208edb0e7ad3c5d`. Other workers' dirty StockAnalysis files were read only; their changes were not adopted or committed here.

The initial confirmed live hydration defect is the Edge job's omitted SPY benchmark. Its stock-only universe determines the Yahoo hydration set, but its signal builder independently reads `data/yf/finance/SPY.json`. The workflow now adds SPY to that existing set. No provider collection, scoring formula or publication ownership changes. The follow-up also fixes the manual source-freshness verification input boundary after the lead released those two files.

A prefix is not a deletion list. `data/macro/activity-surveys.json`, `data/computed/signals.json`, identity configuration, schema files and retired research fixtures remain tracked. The actual file status was checked before labeling these as missing-generation defects.

## Current execution paths

Paths are relative to the product root. A grouped row lists scripts sharing the same job and hydration boundary. “Yes” includes an existing in-script materializer, explicit manifest read, or a same-job producer; it does not claim that a live dispatch was performed in this audit.

| Reader | Retired input | Current job / call chain | Hydrated? | Verdict | Fix or evidence location |
|---|---|---|---|---|---|
| `build-fenok-signal-lens-proxies.mjs` | `data/yf/finance/SPY.json` | `fenok-edge-daily / refresh-fenok-edge`, consolidation | **Missing before fix** | **Live and wrong: benchmark is not a stock-universe member** | This change: `.github/workflows/fenok-edge-daily.yml:159`; reader `scripts/build-fenok-signal-lens-proxies.mjs:403`; stock-only source `scripts/build-fenok-signals.mjs:1106` |
| `build-fenok-signal-lens-proxies.mjs`, `build-fenok-flow-proxies.mjs`, `fetch-fenok-finra-daily-private.mjs`, `fetch-fenok-occ-options-volume.mjs`, `update-fenok-signal-lens-proxies.mjs` | `data/computed/fenok_signals.json`, flow/OCC/news/history; per-stock `data/yf/finance/*`; FINRA admin state | Same Edge job | Yes, apart from SPY above | Safe after benchmark fix | Workflow:132-177 restores FINRA/OCC, platform universe, GDELT and selected Yahoo finance; consolidation:331 |
| `fetch-fenok-krx-daily-private.mjs` | `data/computed/fenok_signals.json`, KRX computed/admin state | `fenok-edge-krx-daily / refresh-fenok-edge-krx` | Yes | Safe | Workflow:133-158, then fetch:231 |
| `fetch-fenok-apewisdom-attention-proxy.mjs` | `data/computed/fenok_signals.json`, attention computed/admin history | `fetch-fenok-apewisdom / fetch-apewisdom-attention` | Yes | Safe | Workflow:102-123 |
| `fetch-fenok-news-tone-proxy.mjs`, `lib/gdelt-selected-source.mjs` | `data/computed/fenok_signals.json`, news computed/admin history | `fetch-fenok-news-tone / fetch-news-tone` | Yes | Safe | Workflow:102-130 |
| `fetch-finra-ats-weekly.mjs` | `data/admin/finra-ats/*`, `data/computed/fenok_signals.json` | `fetch-finra-ats-weekly / fetch-finra-ats-weekly` | Yes | Safe | Workflow:102-126 |
| `run-fenok-private-options.mjs`, `fetch-fenok-private-options.py` | `data/computed/fenok_yahoo_private_options_availability.json`, options admin state | `fetch-fenok-private-options / fetch-private-options` | Yes | Safe; new raw options are a separate scratch output | Workflow:102-117 |
| `fetch-yahoo-ticker.mjs` | `data/macro/yahoo-ticker.json`, hourly admin recovery state | `fetch-yahoo-ticker / fetch-yahoo-ticker` | Yes | Safe | Workflow:100-110 |
| `fetch-fred-macro.mjs` | `data/macro/fred-macro.json` | `fetch-fred-macro / fetch-fred-macro` | Yes, inside entry point | Safe | Script:213 calls `hydrateCanonicalCloudData` before `runFredMacro` |
| `fetch-fred-banking.mjs` | `data/macro/fred-banking-{daily,weekly,monthly,quarterly}.json` | `fetch-fred-banking / fetch-fred-data` | Yes, all four active assets | Safe; verifies one generation across groups | Script:313-317 |
| `fetch-treasury-tga.mjs` | `data/macro/tga.json` | `fetch-treasury-tga / fetch-treasury-tga` | Yes, inside entry point | Safe | Script:542 |
| `fetch-defillama.mjs` | `data/macro/stablecoins.json` | `fetch-defillama / fetch-defillama` | Yes, inside entry point | Safe | Script:284 |
| `fetch-fdic-tier1.mjs` | `data/macro/fdic-tier1.json` | `fetch-fdic / fetch-fdic` | Yes | Safe | Workflow:74 before fetch:87 |
| `fetch-oecd-cli.mjs` | `data/admin/oecd_cli/*`; optional activity-surveys parity input | `fetch-oecd-cli / fetch-oecd-cli` | Yes for retired state | Safe; `data/macro/activity-surveys.json` remains in Git | Workflow:94-103 |
| `build-feno-yardeni-model.mjs` | `data/admin/fred_yardeni/*` and prior model | `fetch-fred-yardeni / fetch-fred-yardeni` | Yes | Safe | Workflow:108-118 |
| `fetch-sentiment.mjs` | `data/admin/sentiment/*` | `fetch-sentiment / fetch-sentiment` | Yes | Safe | Workflow:98-106 |
| `fetch-nasdaq-giw-sox-constituents.mjs` | `data/admin/nasdaq_giw_sox/*` | `fetch-nasdaq-giw-sox / fetch-sox-giw` | Yes | Safe | Workflow:101-111 |
| `fetch-us-indices-daily.mjs` | US index admin state | `fetch-us-indices-daily / fetch-us-indices-daily` | Yes | Safe | Workflow:94-107 |
| `fetch-damodaran-shadow.mjs` | `data/admin/damodaran/*` | `fetch-damodaran-shadow / damodaran` | Yes | Safe | Workflow:105-136 |
| `export-computed-signals.mjs` | `data/macro/*`, prior `data/computed/signals.json` | `coordinate-computed-signals / coordinate-computed-signals`; Update Manifest S4 | Yes, inside entry point | Safe; retained Git signal copy is optional timestamp reuse only | Script calls `hydrateCanonicalCloudData`, `hydrateSmallMacroData`, `hydratePublicFamily('sentiment')` before building |
| `fetch-yf-finance.py` selection/cache, `yahoo_batch_state.py`, `estimate_archive.py`, `rebuild-yf-finance-summary.py` | `data/global-scouter` universe; `data/yf/*`; core-basket/promotion admin inputs; market-facts index | `fetch-yf-finance / acquire-yf-finance` | Yes | Safe for finance collection and exported acquisition state | Workflow:227, 238-275; batch state derived from active `_acquisition-state.json` |
| `fetch-yf-finance.py` frozen stock-detail observation branch; `data_supply_stock_detail.py` / `data_supply_state.py` | `data/admin/data-supply-state/v1` stock-detail state | Same Yahoo acquire job | **No** for this local observer state | Orphan local bookkeeping: branch writes observations, but Yahoo artifact deliberately packs only `data/yf`; no served-empty output proved. Hydration alone cannot publish these observations. Report to catalogue/resolver owner; do not broaden family ownership | Script:498-501, 2995; workflow:557-570; catalogue owns stock state at `publish-cloud-data-generation.mjs:918-921` |
| `build-quarter-closes.py` | `data/sec-13f/*` and Yahoo prices | Yahoo acquire, quarter-close step | Yes | Previously fixed (`4a6cd6777`), remains safe | Workflow:525-534 |
| Yahoo publisher candidate application | Active `data/yf/*` baseline | `fetch-yf-finance / publish-yf-finance` | Yes, independently of acquisition job | Safe | Workflow:676 before candidate overlay |
| Price-history selection in `fetch-yf-finance.py` | `data/admin/data-supply-state/v1/etf-detail-selection.json`, prior price packs | `fetch-yf-finance / price-history` | Yes, explicit manifest asset and private history family | Safe | Workflow:843-865 |
| `fetch-stockanalysis.py`, `stockanalysis_recovery_state.py`, `stockanalysis_etf_lifecycle.py`, `data_supply_stock_detail.py`, `data_supply_state.py`, `yahoo-etf-fallback-recovery.mjs` | Stock/ETF admin state; Yahoo finance twins; analyzer | `fetch-stockanalysis / acquire-stockanalysis` | Yes, candidate-root generation hydration | Safe at workflow boundary; files held by Codex 3 remain untouched | Workflow:518-528 before real fetch:542; :511 is preflight-only |
| `stockanalysis_artifact.py` | Baseline/candidate files under retired prefixes | StockAnalysis acquire and publish jobs | Yes / explicit artifact input | Safe; seed is followed by cloud hydration before baseline capture | Workflow:515-542; publish validation:635/797 |
| `resolve_etf_detail_candidates.py`, `data_supply_resolver.py`, `stockanalysis_etf_plane.py`, `effective-etf-detail-reader.mjs`, `materialize_data_supply_public.py` | Private ETF selected state/provider objects; Yahoo finance twins; usage/analyzer inputs | StockAnalysis ETF plane publish; Update Manifest | Yes | Previously fixed twin path (`fee059e07`); no duplicate repair. Resolver owned by Codex 3 | Workflow materialization:830/1169; supporting public inputs:1212-1217; resolve:1231 |
| `build-stocks-analyzer.mjs`, `lib/yf-screener-enrichment.mjs` | `data/global-scouter/*`, `data/yf/*`, `data/sec-13f/*`, computed projections | `build-stocks-analyzer / build-stocks-analyzer` | Yes | Safe | Workflow:101-117 and family overlay:127 before build:137 |
| `build-revision-movers.mjs`, `build-industry-benchmarks.mjs` | Scouter detail/analyzer | Same analyzer job | Yes | Safe | Workflow:101/103 before :149-150 |
| `build-calendar-prev.mjs` | Prior calendar output; `data/macro/activity-surveys.json` | Same analyzer job | Yes / still tracked | Safe: scouter-derived supplies prior calendar; activity input was not retired | Script:23/226; workflow:103 before :162 |
| `build-sec13f-bridge-index.mjs` | SEC/Scouter/Yahoo/computed input identities | Analyzer job and Update Manifest | Yes | Safe | Analyzer hydration above; Update Manifest:191-204 and projection runner:106 |
| `build-market-facts.py`, `build-market-source-parity.py`, `audit-market-data.py`, `rebuild-yf-finance-summary.py` | `data/yf/*`, Scouter and computed facts | `update-manifest / update-manifest` | Yes / same-job generation | Safe | Workflow:191-204; `publish-update-manifest.sh` restores platform/catalogue; projections:74-77 |
| `build-phase2-closeout-indexes.mjs`, `build-fenok-signals.mjs`, `build-fenok-etf-signals.mjs`, `build-fenok-etf-action-index.mjs`, `build-fenok-etf-core-daily-basket.mjs` | Scouter/Yahoo/SEC/computed/admin source sets | Update Manifest projection steps | Yes / regenerated in dependency order | Safe | `publish-update-manifest.sh:6-43`; `update-manifest-projections.sh:48-53,93-116` |
| `build-data-entity-graph.mjs`, `generate-product-surface-coverage.mjs`, `write-fenok-etf-daily1y-readiness.mjs`, `audit-fenok-s0-source-gaps.mjs`, `write-fenok-s1-stock-public-promotion-dry-run.mjs`, `report-stockanalysis-history-gap.mjs` | Market facts/ETF selection/readiness/admin projections | Update Manifest projection steps | Yes / same-job generation | Safe in this production job; standalone diagnostics require supplied inputs | Projection runner:78,113,120-143 |
| `build-data-supply-detection-floor.mjs`, `build-fenok-data-health-kpi.mjs`, `build-lane-registry-projection.mjs`; associated freshness/config helpers | Producer clocks/recovery indexes in `data/admin`, macro, computed, Yahoo, SEC | Update Manifest S13/S14 | Yes for declared hydrated source families; briefing/digest bindings reserved to Codex 1 | No duplicate edit | `publish-update-manifest.sh:15-40`; projections:48-53,151-175 |
| `build-source-freshness-pins.sh` -> detection floor/KPI builders | Producer payloads, recovery indexes and previous KPI | `remote-heavy-verification / verify`, `suite=npm-script`, `script=build:source-freshness-pins` | **Added active-family hydration** | Live manual gap fixed in source. Reuses materializer with declared detection/recovery inputs and dynamic member roots; rebuilds Yahoo indexes from canonical payloads. Credentialed hosted execution remains unverified | Workflow production environment/conditional credentials; shell hydration precedes detection floor. Removed obsolete Edge coverage rebuild/upload because KPI v4 has no such input |
| `build-edgar-filing-timeline.mjs` | `data/global-scouter/core/stocks_analyzer.json`, EDGAR admin state | `fetch-edgar-filings / fetch-edgar-filings` | Yes | Safe | Workflow:131,143 before :167 |
| `build-13f-enrichment-backfill.mjs`, `build-13f-integrity-indexes.mjs`, `build-13f-trades.mjs`, `build-13f-portfolio-views.mjs`, `build-13f-factor-radar-v2.mjs`, `build-guru-holders-index.mjs`, `lib/sec13f-symbols.mjs`, `sec13f/{cache,ledger,generator}.py` | SEC source/analytics, Scouter identity, Yahoo prices | A1 `sec13f-runner.py` (no Actions collector) | Yes in inspected runner | Safe static boundary; Codex 1 owns runner, no execution or edits here | Runner:309-316; Yahoo analytics hydrator includes finance and quarter closes at materializer:1004-1006 |
| `ops/check-sec13f-live-parity.mjs` | Required local SEC comparison assets | `check-sec13f-live-parity / probe` | Yes, bounded manifest selection | Safe; served side fetched live | Workflow:92-107 before :116 |
| `slickcharts-{daily,composite}-recovery.mjs`, `publish-slickcharts-attempt.sh`, `scrapers/membership-tracker.py` | `data/admin/slickcharts-*` recovery state | SlickCharts daily/weekly/monthly/history/symbols jobs; Update Manifest membership | Yes in each collecting/merging job | Safe; membership projections additionally restored in dedicated membership job | Respective workflow active-family baseline; history:130-136 and :355; Update Manifest restores SlickCharts before membership |
| `ops/check-pipeline-job-health.mjs`, `ops/emit-alarm-state.mjs` | `data/admin/alarm-state.json` | `pipeline-failure-alarm / check` | Yes | Safe; previous state precedes transition | Workflow:95 before :114/:127 |
| `ops/weekly-health-inventory.mjs` | Admin KPI/registry/surface/usage projections and alarm state | `weekly-health-inventory / observe` | Yes, exact manifest/public assets | Safe | Workflow:45-62 before :68 |
| `refresh-family-health.mjs` | ETF/catalogue/Yahoo health reference | `refresh-family-health / prepare,commit` | Direct active manifests, no checkout baseline | Safe current entry point. `readCanonicalReference` is dead legacy helper | Script:230-237 calls `readActiveReference`, not Git helper:30-40 |
| `ops/probe-data-plane-serving.mjs`, deploy live checks | `/data/...` URLs | Serving probe / deploy verification | Live HTTP, not checkout reads | Safe; URI prefix matches are not retired-file reads | Workflow serving-probe:100; deploy live checks |
| `sync-public-data.mjs`, `generate-static-route-manifest.mjs`, `split-oversized-sec13f-investors.mjs`, public-mirror/asset-budget checks | Public data projection trees | App build/deploy | Plane routes deliberately excluded | Safe: cloud data is served from runtime families, not rebuilt from missing Git payloads | App package `sync-static`; sync-public ETF shard projection returns null; generated routing authority excludes enrolled routes |
| `regen-pins.mjs`, lane/policy/derived registry helpers, `prepare-lane-commit.mjs` | Path declarations / Git pin fixtures | Pins autosync / workflow validation | Not data readers | Safe: regenerates registry fixture digests, not data-derived payloads | `regen-pins.mjs:26-58`; current pins workflow:86 |
| Remaining `test-*`, `test_*`, `check-*`/audit scripts under app scripts | Fixture or supplied local artifacts | Validation, optional remote npm command, or no production caller | Fixture/supplied input; no implicit live hydration | Diagnostics are not live-data publication. The corpus-dependent Signal Lens test is an explicit unhydrated test, documented below | Full lexical inventory follows; no test or diagnostic was relabeled a live producer |

## Non-production / legacy readers

No deletion was performed. “No current caller found” means no workflow/npm/production-wrapper caller in the inspected scope; it is not proof that an operator never invokes the command.

| Reader | Retired input | Current job | Hydrated? | Verdict | Location / required input |
|---|---|---|---|---|---|
| `fetch-yf-finance-v0.py` | Legacy Yahoo payloads | None; explicit deprecated entry guard | No | Dead/deprecated | Script:30 |
| `refresh-family-health.mjs:readCanonicalReference` | Git ETF serving index/core basket | None in current CLI | No | Dead legacy function; report only | Current CLI uses `readActiveReference`:234 |
| `finalize-market-data.py`, `build_stock_detail_shadow.py`, `migrate_data_supply_r2_3.py`, `migrate_data_supply_stock_detail.py` | Market facts / provider state | Manual migration/finalization utilities | Caller-supplied tree | Not current unattended readers; no migration executed | Must use a prepared input tree; retain existing migration checks |
| `backfill-kospi-yahoo.mjs`, `backfill-fenok-us-daily-private.mjs`, `build-index-payout-history.mjs`, `fetch-kospi-dart-payout.mjs`, `lib/kospi-dart-payout.mjs` | KRX/Yahoo and retained RIM data | Manual backfill / retired research | Caller-supplied tree; research inputs remain tracked | No active production caller found | Analyzer explicitly retires RIM steps at workflow:152-156 |
| `sec13f/freeze_slice0_contract.py`, `sec13f/freeze_slice_a_oracle.py`, `sec13f/prepare_local_input.py`, `sec13f/shadow.py`, `sec13f/parity.py` | Explicit oracle/local source tree | Fixture/manual comparison | Explicit inputs | Not a silent live reader; runner-owned production covered above | Existing SEC fixture/parity contract |
| `build-identity-index.mjs` | Scouter universe and admin rename input | Manual curated identity writer | Scouter must be supplied; rename input remains tracked | No current workflow caller; do not auto-run | Lane registry documents manual ownership:1328-1334 |
| `generate-stock-field-usage-manifest.mjs` | Source-path declarations | Manual metadata generator | Not a data payload reader | Safe lexical match | Retired prefixes are source labels |
| `select-stockanalysis-daily1y-offset.mjs`, `build-fenok-etf-daily1y-dispatch-plan.mjs` | Admin daily1y plan | Operator/package planning tools | Supplied/generated plan | No current unattended acquisition caller found | Existing plan contract; no empty plan promoted here |
| `audit-fenok-stock-promotion-candidates.mjs`, `write-fenok-s1-promotion-gate-plan.mjs`, `write-fenok-s1-public-mutation-enable-readiness.mjs`, `report-fenok-daily-accumulation.mjs`, `check-yf-finance-mirror-gap.mjs`, `check-us-indices-parity.mjs`, `check-fenok-edge-freshness.mjs`, `audit-fenok-source-availability.mjs`, `datawatch/watch.py` | Supplied local source/diagnostic trees | Manual audit/check | Caller-supplied | Do not treat missing checkout artifacts as live health; no automated publication caller found | Existing CLI prerequisites; no source values fabricated |
| `briefing/config.json`, `briefing/common.py` | Macro URL / briefing inputs | Briefing/digest service | URL/config matches; external binding not verified here | Reserved to Codex 1; no changes | Config:80 is `/data/macro/fred-banking-daily.json` endpoint, not itself a filesystem read |

## Actual result inspected and limits

- On A1 scratch, executed the workflow's actual ticker-set snippet against a stock-only fixture. Before: `NVDA`; after: `NVDA, SPY`. Passed those selected histories to the real `sp500TrackingSignal`: missing benchmark returned `score_0_100=null`, `overlap_days=0`; restored benchmark returned `score_0_100=100`, `overlap_days=79` for identical synthetic return series. This proves the hydration-selection defect and fix, not a live score.
- The existing `test-build-fenok-signal-lens-proxies.mjs` reached its production-corpus assertion and failed at line 101 (`ma20_position ... 0`) because the scratch checkout has no 500-stock live corpus. It was not rerun. No provider, credential or publication route was used to manufacture a passing corpus.
- The changed workflow parsed successfully with PyYAML on A1; the owned-file diff passed whitespace inspection.
- No live proof dispatch was performed. Lead dispatch: `gh workflow run fenok-edge-daily.yml --ref main` (default bounded inputs). This hydrates active inputs, performs the normal FINRA/OCC collection and follows existing publication admission. Do not use `no_fetch=true` on a fresh hosted checkout: private raw caches are not guaranteed to be present. Inspect `data/computed/fenok_signal_lens_proxies.json` from the resulting active FINRA generation and its tracking overlap, without interpreting the synthetic score as live evidence.
- Manual source-freshness follow-up: the command now restores active inputs before rebuilding. On A1 scratch, executed its actual selector/family loop with mock plane functions: required representative health paths selected, unrelated SEC/Scouter/Yahoo histories excluded; YAML parsed and shell syntax passed. The source-freshness policy suite and credentialed hydration were not executed. Lead proof: `remote-heavy-verification.yml`, `suite=npm-script`, `script=build:source-freshness-pins`, `revision=<pushed SHA>`. That is a verification proof request for the lead, not an instruction this worker executed.
- Yahoo stock-detail local bookkeeping is not in the Yahoo candidate artifact. Repairing persistence would cross the catalogue/resolver ownership boundary; adding hydration alone is not a complete fix.

## Lexical search inventory

The following is the complete candidate-file inventory from both full prefixes (`data/admin`, `data/yf`, `data/sec-13f`, `data/global-scouter`, `data/macro`, `data/computed`) and relative/segmented equivalents. It includes tests, registry declarations, HTTP URLs and admin UI paths so those false positives are visible. Current production readers are classified above; this inventory is not a claim that every matching line opens a file.

Candidate files: 319.

- `.github/workflows/admin-auth-guards.yml`
- `.github/workflows/build-stocks-analyzer.yml`
- `.github/workflows/check-sec13f-live-parity.yml`
- `.github/workflows/coordinate-computed-signals.yml`
- `.github/workflows/deploy-worker.yml`
- `.github/workflows/fenok-edge-daily.yml`
- `.github/workflows/fenok-edge-krx-daily.yml`
- `.github/workflows/fetch-damodaran-shadow.yml`
- `.github/workflows/fetch-defillama.yml`
- `.github/workflows/fetch-edgar-filings.yml`
- `.github/workflows/fetch-fdic.yml`
- `.github/workflows/fetch-fenok-apewisdom.yml`
- `.github/workflows/fetch-fenok-news-tone.yml`
- `.github/workflows/fetch-fenok-private-options.yml`
- `.github/workflows/fetch-finra-ats-weekly.yml`
- `.github/workflows/fetch-fred-macro.yml`
- `.github/workflows/fetch-fred-yardeni.yml`
- `.github/workflows/fetch-nasdaq-giw-sox.yml`
- `.github/workflows/fetch-oecd-cli.yml`
- `.github/workflows/fetch-sentiment.yml`
- `.github/workflows/fetch-stockanalysis.yml`
- `.github/workflows/fetch-treasury-tga.yml`
- `.github/workflows/fetch-us-indices-daily.yml`
- `.github/workflows/fetch-yahoo-ticker.yml`
- `.github/workflows/fetch-yf-finance.yml`
- `.github/workflows/pipeline-failure-alarm.yml`
- `.github/workflows/refresh-earnings-overview.yml`
- `.github/workflows/remote-heavy-verification.yml`
- `.github/workflows/update-manifest.yml`
- `.github/workflows/weekly-health-inventory.yml`
- `100xfenok-next/scripts/admin-image-source-guard.mjs`
- `100xfenok-next/scripts/build-source-freshness-pins.sh`
- `100xfenok-next/scripts/check-canonical-root-inventory.mjs`
- `100xfenok-next/scripts/check-cloudflare-asset-budget.mjs`
- `100xfenok-next/scripts/check-data-freshness-report.mjs`
- `100xfenok-next/scripts/check-data-graph.mjs`
- `100xfenok-next/scripts/check-fenok-etf-action-index.mjs`
- `100xfenok-next/scripts/check-fenok-etf-core-daily-basket.mjs`
- `100xfenok-next/scripts/check-fenok-etf-daily1y-dispatch-plan.mjs`
- `100xfenok-next/scripts/check-fenok-etf-new-radar-gate.mjs`
- `100xfenok-next/scripts/check-fenok-etf-signal-gate.mjs`
- `100xfenok-next/scripts/check-fenok-public-mirror-guard.mjs`
- `100xfenok-next/scripts/check-fenok-signal-lens-dual-hexagon.mjs`
- `100xfenok-next/scripts/check-macro-chart-contract.mjs`
- `100xfenok-next/scripts/check-methodology-axis-contract.ts`
- `100xfenok-next/scripts/check-mobile-ux-contract.mjs`
- `100xfenok-next/scripts/check-pro-density-audit.mjs`
- `100xfenok-next/scripts/check-quote-contract.mjs`
- `100xfenok-next/scripts/check-route-iframe-contract.mjs`
- `100xfenok-next/scripts/check-route-key-contract.mjs`
- `100xfenok-next/scripts/check-stock-analyzer-parity-gap.mjs`
- `100xfenok-next/scripts/check-treasury-data-contract.mjs`
- `100xfenok-next/scripts/check-winddown-coach-browser.ts`
- `100xfenok-next/scripts/check-winddown-mobile-browser.mjs`
- `100xfenok-next/scripts/check-winddown-owner-smoke-ready.ts`
- `100xfenok-next/scripts/check-winddown-preservation-browser.ts`
- `100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-enrollment.generated.mjs`
- `100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-generation.mjs`
- `100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-routing-authority.mjs`
- `100xfenok-next/scripts/generate-admin-redirects.mjs`
- `100xfenok-next/scripts/generate-static-route-manifest.mjs`
- `100xfenok-next/scripts/lint-public-copy.mjs`
- `100xfenok-next/scripts/qa-route-catalog.mjs`
- `100xfenok-next/scripts/report-stockanalysis-history-gap.mjs`
- `100xfenok-next/scripts/smoke-stockanalysis-routes.mjs`
- `100xfenok-next/scripts/split-oversized-sec13f-investors.mjs`
- `100xfenok-next/scripts/sync-public-data.mjs`
- `100xfenok-next/scripts/test-admin-static-auth-guard.mjs`
- `100xfenok-next/scripts/test-auth-closed-site.ts`
- `100xfenok-next/scripts/test-auth-user-registry.ts`
- `100xfenok-next/scripts/test-data-supply-public-redaction.mjs`
- `100xfenok-next/scripts/test-deploy-smoke-retry.mjs`
- `100xfenok-next/scripts/test-design-lab-image-unoptimized.ts`
- `100xfenok-next/scripts/test-generate-admin-redirects.mjs`
- `100xfenok-next/scripts/test-route-not-found-guards.ts`
- `100xfenok-next/scripts/test-screener-common-basis-plumbing.ts`
- `100xfenok-next/scripts/test-sector-map.mjs`
- `100xfenok-next/scripts/test-static-route-manifest-generator.mjs`
- `100xfenok-next/scripts/test-sync-public-data.mjs`
- `scripts/audit-fenok-s0-source-gaps.mjs`
- `scripts/audit-fenok-source-availability.mjs`
- `scripts/audit-fenok-stock-promotion-candidates.mjs`
- `scripts/audit-market-data.py`
- `scripts/backfill-fenok-us-daily-private.mjs`
- `scripts/backfill-kospi-yahoo.mjs`
- `scripts/briefing/common.py`
- `scripts/briefing/config.json`
- `scripts/build-13f-enrichment-backfill.mjs`
- `scripts/build-13f-factor-radar-v2.mjs`
- `scripts/build-13f-integrity-indexes.mjs`
- `scripts/build-13f-portfolio-views.mjs`
- `scripts/build-13f-trades.mjs`
- `scripts/build-calendar-prev.mjs`
- `scripts/build-data-entity-graph.mjs`
- `scripts/build-data-supply-detection-floor.mjs`
- `scripts/build-edgar-filing-timeline.mjs`
- `scripts/build-feno-yardeni-model.mjs`
- `scripts/build-fenok-data-health-kpi.mjs`
- `scripts/build-fenok-edge-coverage-index.mjs`
- `scripts/build-fenok-etf-action-index.mjs`
- `scripts/build-fenok-etf-core-daily-basket.mjs`
- `scripts/build-fenok-etf-daily1y-dispatch-plan.mjs`
- `scripts/build-fenok-etf-signals.mjs`
- `scripts/build-fenok-flow-proxies.mjs`
- `scripts/build-fenok-signal-lens-proxies.mjs`
- `scripts/build-fenok-signals.mjs`
- `scripts/build-guru-holders-index.mjs`
- `scripts/build-identity-index.mjs`
- `scripts/build-index-payout-history.mjs`
- `scripts/build-lane-registry-projection.mjs`
- `scripts/build-market-facts.py`
- `scripts/build-market-source-parity.py`
- `scripts/build-phase2-closeout-indexes.mjs`
- `scripts/build-quarter-closes.py`
- `scripts/build-revision-movers.mjs`
- `scripts/build-sec13f-bridge-index.mjs`
- `scripts/build-slickcharts-discovery.mjs`
- `scripts/build-stocks-analyzer.mjs`
- `scripts/build_stock_detail_shadow.py`
- `scripts/check-bundled-data-catchup.mjs`
- `scripts/check-cloudflare-asset-budget.mjs`
- `scripts/check-deploy-source-fence.mjs`
- `scripts/check-fenok-data-health-kpi.mjs`
- `scripts/check-fenok-edge-freshness.mjs`
- `scripts/check-lane-registry-completeness.mjs`
- `scripts/check-lane-registry-sync.mjs`
- `scripts/check-us-indices-parity.mjs`
- `scripts/check-yf-finance-mirror-gap.mjs`
- `scripts/data_supply_resolver.py`
- `scripts/data_supply_stock_detail.py`
- `scripts/datawatch/watch.py`
- `scripts/effective-etf-detail-reader.mjs`
- `scripts/estimate_archive.py`
- `scripts/export-computed-signals.mjs`
- `scripts/fetch-damodaran-shadow.mjs`
- `scripts/fetch-defillama.mjs`
- `scripts/fetch-fdic-tier1.mjs`
- `scripts/fetch-fenok-apewisdom-attention-proxy.mjs`
- `scripts/fetch-fenok-finra-daily-private.mjs`
- `scripts/fetch-fenok-krx-daily-private.mjs`
- `scripts/fetch-fenok-news-tone-proxy.mjs`
- `scripts/fetch-fenok-occ-options-volume.mjs`
- `scripts/fetch-fenok-private-options.py`
- `scripts/fetch-finra-ats-weekly.mjs`
- `scripts/fetch-fred-banking.mjs`
- `scripts/fetch-fred-macro.mjs`
- `scripts/fetch-kospi-dart-payout.mjs`
- `scripts/fetch-nasdaq-giw-sox-constituents.mjs`
- `scripts/fetch-oecd-cli.mjs`
- `scripts/fetch-sentiment.mjs`
- `scripts/fetch-stockanalysis.py`
- `scripts/fetch-treasury-tga.mjs`
- `scripts/fetch-us-indices-daily.mjs`
- `scripts/fetch-yahoo-ticker.mjs`
- `scripts/fetch-yf-finance-v0.py`
- `scripts/fetch-yf-finance.py`
- `scripts/finalize-market-data.py`
- `scripts/fixtures/data_supply/detection_floor/artifacts.fixture.json`
- `scripts/fixtures/data_supply/detection_floor/cases.expected.json`
- `scripts/generate-product-surface-coverage.mjs`
- `scripts/generate-stock-field-usage-manifest.mjs`
- `scripts/lib/cloud-data-plane-retention-registry.mjs`
- `scripts/lib/data-supply-detection-config.mjs`
- `scripts/lib/data-supply-lkg-store.mjs`
- `scripts/lib/derived-asset-registry.mjs`
- `scripts/lib/dividend-yield-unit.mjs`
- `scripts/lib/fenok-data-health-freshness.mjs`
- `scripts/lib/gdelt-selected-source.mjs`
- `scripts/lib/kospi-dart-payout.mjs`
- `scripts/lib/kpi-contract-constants.mjs`
- `scripts/lib/kpi-fixture-hermetic-bootstrap.mjs`
- `scripts/lib/lane-registry.mjs`
- `scripts/lib/lane-routing.mjs`
- `scripts/lib/sec13f-symbols.mjs`
- `scripts/lib/yf-screener-enrichment.mjs`
- `scripts/materialize-cloud-data-plane-family.mjs`
- `scripts/materialize-update-manifest-routes.mjs`
- `scripts/materialize_data_supply_public.py`
- `scripts/migrate_data_supply_r2_3.py`
- `scripts/migrate_data_supply_stock_detail.py`
- `scripts/official_etf_sources.py`
- `scripts/ops/check-pipeline-job-health.mjs`
- `scripts/ops/check-sec13f-live-parity.mjs`
- `scripts/ops/emit-alarm-state.mjs`
- `scripts/ops/probe-data-plane-serving.mjs`
- `scripts/ops/test-admin-auth-guards.mjs`
- `scripts/ops/test-alarm-liveness.mjs`
- `scripts/ops/test-check-pipeline-job-health.mjs`
- `scripts/ops/test-probe-data-plane-serving.mjs`
- `scripts/ops/weekly-health-inventory.mjs`
- `scripts/prepare-lane-commit.mjs`
- `scripts/public-mirror-untrack-disposition.json`
- `scripts/publish-cloud-data-generation.mjs`
- `scripts/publish-slickcharts-attempt.sh`
- `scripts/publish-update-manifest.sh`
- `scripts/rebuild-yf-finance-summary.py`
- `scripts/refresh-family-health.mjs`
- `scripts/report-fenok-daily-accumulation.mjs`
- `scripts/resolve_etf_detail_candidates.py`
- `scripts/run-fenok-private-options.mjs`
- `scripts/scrapers/membership-tracker.py`
- `scripts/sec13f/README.md`
- `scripts/sec13f/cache.py`
- `scripts/sec13f/config/investors.yaml`
- `scripts/sec13f/freeze_slice0_contract.py`
- `scripts/sec13f/freeze_slice_a_oracle.py`
- `scripts/sec13f/generator.py`
- `scripts/sec13f/ledger.py`
- `scripts/sec13f/parity.py`
- `scripts/sec13f/prepare_local_input.py`
- `scripts/sec13f/shadow.py`
- `scripts/select-stockanalysis-daily1y-offset.mjs`
- `scripts/slickcharts-composite-recovery.mjs`
- `scripts/slickcharts-daily-recovery.mjs`
- `scripts/stockanalysis_artifact.py`
- `scripts/stockanalysis_etf_lifecycle.py`
- `scripts/stockanalysis_etf_plane.py`
- `scripts/stockanalysis_recovery_state.py`
- `scripts/test-admin-image-source-guard.mjs`
- `scripts/test-audit-fenok-stock-promotion-candidates.mjs`
- `scripts/test-build-data-supply-detection-floor.mjs`
- `scripts/test-build-edgar-filing-timeline.mjs`
- `scripts/test-build-edgar-lkg-recovery.mjs`
- `scripts/test-build-feno-yardeni-lkg-recovery.mjs`
- `scripts/test-build-feno-yardeni-model.mjs`
- `scripts/test-build-fenok-data-health-kpi.mjs`
- `scripts/test-build-fenok-flow-proxies.mjs`
- `scripts/test-build-fenok-signal-lens-proxies.mjs`
- `scripts/test-build-guru-holders-index.mjs`
- `scripts/test-build-stocks-analyzer-manifest.mjs`
- `scripts/test-bundled-data-catchup.mjs`
- `scripts/test-cloud-data-plane-global-scouter-shadow.mjs`
- `scripts/test-cloud-data-plane-publisher.mjs`
- `scripts/test-cloud-data-plane-routing-authority.mjs`
- `scripts/test-cloud-data-plane-worker-read.mjs`
- `scripts/test-cloud-data-plane-worker-route.mjs`
- `scripts/test-data-integrity-fixes.mjs`
- `scripts/test-data-supply-lkg-store.mjs`
- `scripts/test-derived-asset-registry.mjs`
- `scripts/test-estimate-archive.py`
- `scripts/test-etf-readiness-gate.mjs`
- `scripts/test-export-computed-signals.mjs`
- `scripts/test-factset-public-exclusion.mjs`
- `scripts/test-family-health.mjs`
- `scripts/test-fenok-native-signal-formula-contract.mjs`
- `scripts/test-fetch-damodaran-shadow.mjs`
- `scripts/test-fetch-defillama.mjs`
- `scripts/test-fetch-fdic-tier1.mjs`
- `scripts/test-fetch-fenok-apewisdom-attention-proxy.mjs`
- `scripts/test-fetch-fenok-finra-daily-private.mjs`
- `scripts/test-fetch-fenok-finra-lkg-recovery.mjs`
- `scripts/test-fetch-fenok-krx-daily-private.mjs`
- `scripts/test-fetch-fenok-news-tone-proxy.mjs`
- `scripts/test-fetch-fenok-occ-lkg-recovery.mjs`
- `scripts/test-fetch-fenok-private-options-workflow.mjs`
- `scripts/test-fetch-finra-ats-weekly-workflow.mjs`
- `scripts/test-fetch-finra-ats-weekly.mjs`
- `scripts/test-fetch-fred-banking.mjs`
- `scripts/test-fetch-fred-macro.mjs`
- `scripts/test-fetch-nasdaq-giw-sox-constituents.mjs`
- `scripts/test-fetch-oecd-cli.mjs`
- `scripts/test-fetch-sentiment.mjs`
- `scripts/test-fetch-treasury-tga.mjs`
- `scripts/test-fetch-us-indices-daily.mjs`
- `scripts/test-fetch-yahoo-ticker.mjs`
- `scripts/test-fetch-yf-finance-workflow.mjs`
- `scripts/test-generate-product-surface-coverage-etf-live-dates.mjs`
- `scripts/test-kospi-dart-payout.mjs`
- `scripts/test-lane-registry.mjs`
- `scripts/test-materialize-cloud-data-plane-family.mjs`
- `scripts/test-pipeline-failure-alarm-manifest.mjs`
- `scripts/test-prepare-lane-commit.mjs`
- `scripts/test-producer-lkg-state.mjs`
- `scripts/test-public-mirror-untrack-prereqs.mjs`
- `scripts/test-publish-slickcharts-attempt.mjs`
- `scripts/test-run-fenok-private-options.mjs`
- `scripts/test-sec13f-bridge-index.mjs`
- `scripts/test-sec13f-live-privacy.mjs`
- `scripts/test-sec13f-retention-web-contract.mjs`
- `scripts/test-sec13f-source-route.mjs`
- `scripts/test-slickcharts-composite-recovery.mjs`
- `scripts/test-slickcharts-daily-recovery.mjs`
- `scripts/test-stage-lane-manifest.mjs`
- `scripts/test-stock-market-classification.mjs`
- `scripts/test-update-manifest-materializations.mjs`
- `scripts/test-update-manifest-runner.mjs`
- `scripts/test-write-fenok-etf-daily1y-readiness.mjs`
- `scripts/test-yahoo-batch-public-exclusion.mjs`
- `scripts/test-yahoo-etf-fallback-recovery.mjs`
- `scripts/test-yf-estimates-archive-public-exclusion.mjs`
- `scripts/test-yf-screener-enrichment.mjs`
- `scripts/test-yoo-replica-freeze.mjs`
- `scripts/test_audit_market_data.py`
- `scripts/test_build_market_facts.py`
- `scripts/test_build_market_facts_source_as_of.py`
- `scripts/test_build_stock_detail_shadow.py`
- `scripts/test_data_spine_policy.py`
- `scripts/test_data_supply_resolver.py`
- `scripts/test_data_supply_state.py`
- `scripts/test_data_supply_state_crash_probe.py`
- `scripts/test_data_supply_stock_detail.py`
- `scripts/test_fetch_stockanalysis_fixtures.py`
- `scripts/test_fetch_yf_finance_selection.py`
- `scripts/test_market_source_parity.py`
- `scripts/test_materialize_data_supply_public.py`
- `scripts/test_migrate_data_supply_r2_3.py`
- `scripts/test_migrate_data_supply_stock_detail.py`
- `scripts/test_resolve_etf_detail_candidates.py`
- `scripts/test_stockanalysis_artifact.py`
- `scripts/test_stockanalysis_etf_lifecycle.py`
- `scripts/test_stockanalysis_recovery_state.py`
- `scripts/update-manifest-projections.sh`
- `scripts/update-manifest.py`
- `scripts/write-fenok-etf-daily1y-readiness.mjs`
- `scripts/write-fenok-s1-promotion-gate-plan.mjs`
- `scripts/write-fenok-s1-public-mutation-enable-readiness.mjs`
- `scripts/write-fenok-s1-stock-public-promotion-dry-run.mjs`
- `scripts/yahoo-etf-fallback-recovery.mjs`
- `scripts/yahoo_batch_state.py`
