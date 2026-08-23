#!/usr/bin/env node
// Publish one data family to the cloud data plane (R2 objects + coordinator
// ledger/pointer) under the byte-locked contract in
// scripts/lib/cloud-data-plane-generation.mjs.
//
// Order of operations (non-negotiable):
//   1. Build the generation manifest from the files on disk.
//   2. Run the R2 free-tier cost gate as a child process with planned counts
//      at least 2x the real ones. Exit 2 from the gate stops everything.
//   3. publishGeneration with expectedPointerSequence read from the live
//      pointer (see resolveExpectedPointerSequence for the resume case).
//   4. Byte-parity verification resolved through the pointer ourselves
//      (resolvePublicAsset is unusable here: these assets are private).
//   5. One JSON summary line on stdout.
//
// Publish-outcome evidence (2026-08-10 contract): after every REAL per-family
// publish outcome the script appends one record to
// data/admin/data-supply-state/publish-outcomes/<family>.json — published,
// resumed, gate_blocked and failed runs alike. Dry-run, retention
// (bucket-level, no family) and the deliberate rollback/chaos-drill modes
// write nothing. The shard write is atomic and non-blocking: a shard write
// failure is logged and surfaced as outcome_shard in the summary, but never
// changes the publish's exit code, summary line or result vocabulary.
// PUBLISH_OUTCOMES_ROOT overrides the evidence root (tests redirect to a
// temp dir).
//
// Idempotent republish: generation_id derives from a SEMANTIC fingerprint of
// source_sha plus the sorted persisted asset metadata (path, sha256, bytes,
// content_type, source_as_of, privacy_class), so unchanged content AND
// unchanged metadata yield the same generation_id, while a metadata-only
// correction (identical payload bytes, different source_as_of — e.g. FRED
// Banking's uniform source date -> per-asset dates) yields a NEW immutable
// generation that reuses the content-addressed payload objects. source_sha
// itself stays payload-only for dedupe/parity. created_at and other run
// timestamps never enter identity; created_at-fallback families normalize
// their dynamic acquisition-day source_as_of out of the fingerprint so
// unchanged fallback content stays idempotent across runs.
// When the live pointer already targets that generation we re-read the STORED
// manifest and pass expectedPointerSequence = pointer.sequence - 1, which is
// the only calling shape under which the contract's finalizeOrResumePromotion
// can resume the existing receipt instead of advancing the pointer. Passing
// the live sequence with a rebuilt manifest would instead collide with the
// contract's "active and previous generation must differ" rule.
//
// Crash recovery: resolveExpectedPointerSequence also stabilizes a retry of an
// interrupted publish. If the manifest object for this generation is already
// stored (written before the crash) it is adopted verbatim so putIfAbsent
// stays byte-identical, and if the deterministic receipt id already exists in
// state "prepared" its created_at is reused as the publish `now` so
// ledger.prepare stays byte-identical (the contract rejects a same-id receipt
// with different bytes as RECEIPT_CONFLICT).
//
// Chaos drills (--chaos=<mode>, explicit opt-in only):
//   stale-sequence      publish with expectedPointerSequence one behind the
//                       live pointer; the contract's STALE_WRITER must surface
//                       and the pointer must not advance.
//   abort-after-prepare inject CHAOS_ABORT_AFTER_PREPARE from a pointerStore
//                       wrapper whose compareAndSwap throws before delegating,
//                       simulating a crash after ledger.prepare; the pointer
//                       must not advance and the receipt stays "prepared". An
//                       unchanged re-run then resumes the same receipt_id and
//                       advances the pointer exactly once (see above).
//
// Rollback (--rollback): restore the pointer's previous generation through the
// contract's rollbackGeneration. The live pointer is read first and the mode
// refuses with ROLLBACK_TARGET_MISSING unless previous is non-null; the live
// sequence is passed as expectedPointerSequence. Rollback moves the sequence
// FORWARD (never rewinds) and writes no objects — only the coordinator ledger
// and pointer change. The JSON summary reports the sequence and both
// generation ids before and after.
//
// Per-family coordinators: publish, chaos and rollback talk to the family's
// OWN coordinator Durable Object instance; retention (bucket-level) talks to
// EVERY family's instance. The family name is passed as coordinatorName to the
// adapter and as the x-data-plane-family header through the remote shim; the
// worker route selects the instance by that header. One family can never
// displace another's active generation. Cutover is clean: each family restarts
// at sequence 0 in its own instance, the legacy shared instance keeps its
// history, and
// content-addressed objects make the first republish a no-op for the bucket.
//
// Retention (--retention, dry-run by default; --retention-delete for real
// deletion): collect objects/sha256/* payloads that NO retained manifest of
// ANY family references. Pointers and receipts are PER FAMILY (each family has
// its own coordinator instance, its own sequence and its own ledger), so the
// retained set is computed per family — the 3 newest generations of that
// family by created_at, that family's pointer active AND previous entries
// (non-negotiable, that is the family's rollback target), and that family's
// generations named by receipts still in state "prepared" — and then unioned.
// The OBJECT STORE stays shared and content-addressed, so the reference scan
// is the union across families: an object referenced by a retained manifest of
// family A survives even if the only other referencing generation belongs to
// family B and is otherwise collectable. Every manifest in the bucket is read,
// parsed and validated; ANY unreadable or corrupt manifest — or a retained
// generation whose manifest is missing — aborts the whole run with
// RETENTION_REFERENCE_SET_INCOMPLETE and ZERO deletions. Retention is
// BUCKET-LEVEL: it scans every family's own coordinator instance (pointer +
// prepared receipts) and rejects --family outright; a family that fails to
// answer aborts with RETENTION_FAMILY_UNREADABLE and ZERO deletions. Manifest
// keys, pointer keys, probe/* and the explicit RETENTION_PROTECTED_KEYS (the
// six keys the owner rule names: five P1 evidence objects + probe/lag.json)
// are never candidates. The dry run emits one JSON line listing every
// candidate with key, size and the reason it is unreferenced; real deletion
// additionally requires --retention-delete. The cost gate runs first in both
// modes even though DeleteObject is free on the free tier.
//
// Migration semantics (per-family coordinators): CLEAN CUTOVER. Both families
// restart at sequence 0 in their own instances; the legacy shared instance
// keeps its history untouched; objects are content-addressed, so the first
// republish into a fresh family instance writes nothing — putIfAbsent finds
// every payload already present and only the coordinator ledger and pointer
// change.
//
// Env: CLOUDFLARE_API_TOKEN (gate + R2 REST), CLOUDFLARE_ACCOUNT_ID (defaulted
// below), DATA_PLANE_ENDPOINT, DATA_PLANE_WRITE_KEY. A missing endpoint or key
// is a clear error before any write; the token is enforced by the gate first.

import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  GENERATION_MANIFEST_SCHEMA,
  publishGeneration,
  rollbackGeneration,
  runBoundedAsyncPool,
  sha256Bytes,
  sha256Canonical,
  validateGenerationManifest,
  validatePublicationReceipt,
} from "./lib/cloud-data-plane-generation.mjs";
import { buildCandidateScope } from "./lib/cloud-data-plane-candidate-scope.mjs";
import { PLANE_PUBLISH_OUTCOME_BINDINGS, PLANE_PUBLISHER_EXCEPTIONS } from "./lib/lane-registry.mjs";
import { classifyPreparedReceipts } from "./lib/cloud-data-plane-prepared-receipt-lifecycle.mjs";
import { createCloudflareCloudDataPlane } from "./lib/cloud-data-plane-cloudflare-adapter.mjs";
import { createR2RestBucket } from "./lib/cloud-data-plane-r2-rest.mjs";
import { createRemoteCoordinatorNamespace } from "./lib/cloud-data-plane-remote-coordinator.mjs";
import {
  appendPublishOutcome,
  buildPublishOutcomeBinding,
  buildPublishOutcomeRecord,
} from "./lib/publish-outcome-shard.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "check-r2-free-tier-usage.mjs");
const R2_BUCKET = "fenok-data-plane";
const DEFAULT_ACCOUNT_ID = "aeeb5ea3affe55a2219d08ea02dad9e1";

// Publish-outcome evidence root (2026-08-10 contract): every real per-family
// publish outcome appends a record to
// data/admin/data-supply-state/publish-outcomes/<family>.json.
// PUBLISH_OUTCOMES_ROOT overrides the root (tests redirect to a temp dir);
// the production default is the repo state dir.
const DEFAULT_PUBLISH_OUTCOMES_ROOT = path.join(
  REPO_ROOT,
  "data",
  "admin",
  "data-supply-state",
  "publish-outcomes",
);

// Family descriptor table. Fields:
//   root             filesystem location of the source file(s), repo-relative
//   manifest_prefix  logical asset path prefix in the plane (defaults to root;
//                    must satisfy the contract's privacy prefixes: "data/" for
//                    private, "public/data/" or "public/generated/" for public)
//   files            explicit enrollment list (defaults to walking the whole
//                    root tree); paths are relative to root
//   candidate_scope_id optional registry-derived candidate scope replacing a
//                    hand-written files list for a multi-root publication
//   privacy_class    "private" or "public" (contract-enforced against prefix)
//   reader_enrollment optional public read-side enrollment switch; only an
//                    explicit false suppresses generated reader enrollment
//   plan             cost-gate declaration, >= 2x the real spend
//   policy           contract publication policy budgets
//   validate_public_payload  required for public families: the contract calls
//                    it on every public asset before writing
//   source_as_of     where the family's SOURCE time comes from (see
//                    resolveSourceAsOf): { file, key } reads key from the JSON
//                    at <root>/<file>; { key } (no file) reads key from the
//                    single enrolled payload; { files: { "<rel>": { key } } }
//                    reads key from each declared file's own JSON, while a
//                    per-file { max_date: { array, key } } (array may be null
//                    for a top-level row array) takes that file's maximum row
//                    date. EVERY asset carries its own source date (summary
//                    reports the conservative minimum, origin "per-asset");
//                    { file, max_date: { array, key } } takes the maximum
//                    normalized key over the named top-level array (e.g. the
//                    FDIC latest reported quarter), never the collection time.
//                    { file, max_date: { array: null, key } } is the same mode
//                    for payloads whose top-level JSON IS the row array (e.g.
//                    the US index series files, plain [{date, value}, ...]).
//                    The value is normalized to an ISO day (YYYY-MM-DD) and
//                    written to every asset's source_as_of. In the legacy
//                    { file, key } mode a declared file that is absent from
//                    the built tree falls back to the manifest created_at —
//                    marked as "created_at-fallback" in the emitted origin so
//                    acquisition time is never silently blurred into source
//                    time. A present-but-invalid value fails loudly; the
//                    per-file and max_date modes also fail loudly on any
//                    missing or malformed declaration (they never fall back).
//                    { per_asset_resolver: "stockanalysis_detail_source_timestamp" }
//                    applies the existing StockAnalysis ETF acquisition priority
//                    independently to every enrolled JSON payload. A payload
//                    with NO source candidate at all is an availability
//                    observation, so its validated fetched_at is the truthful
//                    observation clock; malformed source candidates still fail.
//                    { per_asset_key } reads the named top-level key from every
//                    enrolled JSON payload, stores each asset's own date and
//                    reports the conservative minimum for the family.
// P5+ adds more families here.
export const FAMILIES = {
  "oecd-cli": {
    root: "data/admin/oecd_cli",
    privacy_class: "private",
    // The lane's LKG state index records when the family data was acquired.
    source_as_of: { file: "index.json", key: "updated_at" },
    // Gate declaration: >= 2x the measured 4 PutObject / 592,351 bytes.
    plan: { class_a: 40, bytes: 1_200_000 },
    policy: { max_assets: 64, max_total_bytes: 16_000_000 },
  },
  "fred-macro": {
    // Publishes from the canonical file, exactly like every other data/macro
    // family. It used to read the public mirror instead, which only worked
    // because the producer wrote that mirror directly; once the producer became
    // canonical-only the publisher could not find its input at all.
    root: "data/macro",
    manifest_prefix: "public/data/macro",
    files: ["fred-macro.json"],
    privacy_class: "public",
    // The payload itself carries the as-of date in its top-level "updated".
    source_as_of: { key: "updated" },
    // Gate declaration: >= 2x the measured 1 PutObject / 530,240 bytes.
    plan: { class_a: 10, bytes: 1_100_000 },
    policy: { max_assets: 8, max_total_bytes: 4_000_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "defillama-stablecoins": {
    root: "data/macro",
    manifest_prefix: "public/data/macro",
    files: ["stablecoins.json"],
    privacy_class: "public",
    source_as_of: { key: "updated" },
    plan: { class_a: 10, bytes: 2_200_000 },
    policy: { max_assets: 4, max_total_bytes: 4_400_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "fdic-tier1": {
    root: "data/macro",
    manifest_prefix: "public/data/macro",
    files: ["fdic-tier1.json"],
    privacy_class: "public",
    // Latest reported quarter from max data[].date — never the top-level
    // "updated" collection time.
    source_as_of: { file: "fdic-tier1.json", max_date: { array: "data", key: "date" } },
    plan: { class_a: 10, bytes: 1_100_000 },
    policy: { max_assets: 4, max_total_bytes: 25_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "treasury-tga": {
    root: "data/macro",
    manifest_prefix: "public/data/macro",
    files: ["tga.json"],
    privacy_class: "public",
    source_as_of: { key: "updated" },
    plan: { class_a: 10, bytes: 1_600_000 },
    policy: { max_assets: 4, max_total_bytes: 3_200_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "fred-banking": {
    root: "data/macro",
    manifest_prefix: "public/data/macro",
    files: ["fred-banking-daily.json","fred-banking-weekly.json","fred-banking-monthly.json","fred-banking-quarterly.json"],
    privacy_class: "public",
    // Each file carries its own top-level source_as_of: every asset gets its
    // own date instead of one family-wide date.
    source_as_of: {
      files: {
        "fred-banking-daily.json": { key: "source_as_of" },
        "fred-banking-weekly.json": { key: "source_as_of" },
        "fred-banking-monthly.json": { key: "source_as_of" },
        "fred-banking-quarterly.json": { key: "source_as_of" },
      },
    },
    plan: { class_a: 10, bytes: 1_800_000 },
    policy: { max_assets: 16, max_total_bytes: 3_600_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "fred-yardeni": {
    root: "data/yardney",
    manifest_prefix: "public/data/yardney",
    files: ["yardney_model.json"],
    privacy_class: "public",
    // Latest payload date from max data[].date — the model rows carry the
    // series' real date; never the collection time.
    source_as_of: { file: "yardney_model.json", max_date: { array: "data", key: "date" } },
    plan: { class_a: 10, bytes: 1_100_000 },
    policy: { max_assets: 4, max_total_bytes: 1_300_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "damodaran": {
    root: "data/damodaran",
    manifest_prefix: "public/data/damodaran",
    files: ["industries.json","historical_erp.json","credit_ratings.json","erp.json","industry_metrics.json","industry_metrics_regions.json"],
    privacy_class: "public",
    plan: { class_a: 12, bytes: 9_800_000 },
    policy: { max_assets: 24, max_total_bytes: 19_500_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "sentiment": {
    root: "data/sentiment",
    manifest_prefix: "public/data/sentiment",
    files: ["aaii.json","cftc-sp500.json","cnn-breadth.json","cnn-components.json","cnn-fear-greed.json","cnn-junk-bond.json","cnn-momentum.json","cnn-put-call.json","cnn-safe-haven.json","cnn-strength.json","crypto-fear-greed.json","move.json","schema.json","vix.json"],
    privacy_class: "public",
    plan: { class_a: 28, bytes: 3_500_000 },
    policy: { max_assets: 56, max_total_bytes: 7_000_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "edgar-korean-summaries": {
    root: "data/edgar-korean-summaries",
    manifest_prefix: "public/data/edgar-korean-summaries",
    // Internal telemetry and documentation, not data payloads. ops/ holds
    // batch-skip-log.jsonl, which is JSONL and made validate_public_payload
    // throw on every publish this family has ever attempted since 2026-06-21.
    exclude: ["ops/", "README.md"],
    privacy_class: "public",
    source_as_of: { file: "index.json", key: "updated" },
    plan: { class_a: 3690, bytes: 29_900_000 },
    policy: { max_assets: 7380, max_total_bytes: 59_800_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "yahoo-ticker-macro": {
    root: "data/macro",
    manifest_prefix: "public/data/macro",
    files: ["yahoo-ticker.json"],
    privacy_class: "public",
    source_as_of: { key: "updated" },
    plan: { class_a: 10, bytes: 1_100_000 },
    policy: { max_assets: 4, max_total_bytes: 3_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "nasdaq-giw-sox": {
    root: "data/indices",
    manifest_prefix: "public/data/indices",
    files: ["nasdaq-giw-sox-constituents.json"],
    privacy_class: "public",
    source_as_of: { key: "as_of" },
    plan: { class_a: 10, bytes: 1_100_000 },
    policy: { max_assets: 4, max_total_bytes: 16_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "us-indices-daily": {
    root: "data/indices",
    manifest_prefix: "public/data/indices",
    files: ["sp500.json","nasdaq.json","nasdaq100.json","sox.json"],
    privacy_class: "public",
    // Each independent series is a plain top-level array of { date, value }
    // rows. Resolve every asset from ITS OWN latest row date; the producer's
    // parity gate is per-series and does not promise cross-series date
    // equality. Never stamp one series' date onto another asset.
    source_as_of: {
      files: {
        "sp500.json": { max_date: { array: null, key: "date" } },
        "nasdaq.json": { max_date: { array: null, key: "date" } },
        "nasdaq100.json": { max_date: { array: null, key: "date" } },
        "sox.json": { max_date: { array: null, key: "date" } },
      },
    },
    // Gate declaration: >= 2x the measured 4 PutObject / 1,304,515 bytes.
    plan: { class_a: 10, bytes: 2_700_000 },
    policy: { max_assets: 20, max_total_bytes: 5_400_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "slickcharts-daily": {
    root: "data/slickcharts",
    manifest_prefix: "public/data/slickcharts",
    files: ["gainers.json","losers.json","treasury.json","currency.json","mortgage.json"],
    privacy_class: "public",
    source_as_of: { file: "gainers.json", key: "updated" },
    plan: { class_a: 10, bytes: 15_900_000 },
    policy: { max_assets: 20, max_total_bytes: 31_800_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "slickcharts-weekly": {
    root: "data/slickcharts",
    manifest_prefix: "public/data/slickcharts",
    files: ["sp500.json","magnificent7.json","etf.json","berkshire.json"],
    privacy_class: "public",
    source_as_of: { file: "sp500.json", key: "updated" },
    plan: { class_a: 10, bytes: 1_100_000 },
    policy: { max_assets: 16, max_total_bytes: 450_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "slickcharts-monthly": {
    root: "data/slickcharts",
    manifest_prefix: "public/data/slickcharts",
    files: ["sp500-returns.json","sp500-returns-details.json","nasdaq100-returns.json","dowjones-returns.json","sp500-drawdown.json","btc-returns.json","eth-returns.json","sp500-performance.json","nasdaq100-performance.json","dowjones-performance.json","sp500-yield.json","nasdaq100-yield.json","dowjones-yield.json","sp500-analysis.json","nasdaq100-analysis.json","dowjones-analysis.json","sp500-marketcap.json","nasdaq100-ratio.json","nasdaq100.json","dowjones.json","inflation.json"],
    privacy_class: "public",
    source_as_of: { file: "sp500-returns.json", key: "updated" },
    plan: { class_a: 42, bytes: 1_600_000 },
    policy: { max_assets: 84, max_total_bytes: 3_200_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "slickcharts-history": {
    root: "data/slickcharts",
    manifest_prefix: "public/data/slickcharts",
    files: ["stocks-returns.json","stocks-dividends.json","stocks-dividends-recent.json","stocks-dividends-historical.json","stocks/A.json","stocks/AAPL.json","stocks/ABBV.json","stocks/ABNB.json","stocks/ABT.json","stocks/ACGL.json","stocks/ACN.json","stocks/ADBE.json","stocks/ADI.json","stocks/ADM.json","stocks/ADP.json","stocks/ADSK.json","stocks/AEE.json","stocks/AEP.json","stocks/AES.json","stocks/AFL.json","stocks/AIG.json","stocks/AIZ.json","stocks/AJG.json","stocks/AKAM.json","stocks/ALAB.json","stocks/ALB.json","stocks/ALGN.json","stocks/ALL.json","stocks/ALLE.json","stocks/ALNY.json","stocks/AMAT.json","stocks/AMCR.json","stocks/AMD.json","stocks/AME.json","stocks/AMGN.json","stocks/AMP.json","stocks/AMT.json","stocks/AMZN.json","stocks/ANET.json","stocks/AON.json","stocks/AOS.json","stocks/APA.json","stocks/APD.json","stocks/APH.json","stocks/APO.json","stocks/APP.json","stocks/APTV.json","stocks/ARE.json","stocks/ARES.json","stocks/ARM.json","stocks/ASML.json","stocks/ATO.json","stocks/AVB.json","stocks/AVGO.json","stocks/AVY.json","stocks/AWK.json","stocks/AXON.json","stocks/AXP.json","stocks/AZN.json","stocks/AZO.json","stocks/BA.json","stocks/BAC.json","stocks/BALL.json","stocks/BAX.json","stocks/BBY.json","stocks/BDX.json","stocks/BEN.json","stocks/BF.B.json","stocks/BG.json","stocks/BIIB.json","stocks/BK.json","stocks/BKNG.json","stocks/BKR.json","stocks/BLDR.json","stocks/BLK.json","stocks/BMY.json","stocks/BNY.json","stocks/BR.json","stocks/BRK.B.json","stocks/BRO.json","stocks/BSX.json","stocks/BX.json","stocks/BXP.json","stocks/C.json","stocks/CAG.json","stocks/CAH.json","stocks/CARR.json","stocks/CASY.json","stocks/CAT.json","stocks/CB.json","stocks/CBOE.json","stocks/CBRE.json","stocks/CCEP.json","stocks/CCI.json","stocks/CCL.json","stocks/CDNS.json","stocks/CDW.json","stocks/CEG.json","stocks/CF.json","stocks/CFG.json","stocks/CHD.json","stocks/CHRW.json","stocks/CHTR.json","stocks/CI.json","stocks/CIEN.json","stocks/CINF.json","stocks/CL.json","stocks/CLX.json","stocks/CMCSA.json","stocks/CME.json","stocks/CMG.json","stocks/CMI.json","stocks/CMS.json","stocks/CNC.json","stocks/CNP.json","stocks/COF.json","stocks/COHR.json","stocks/COIN.json","stocks/COO.json","stocks/COP.json","stocks/COR.json","stocks/COST.json","stocks/CPAY.json","stocks/CPB.json","stocks/CPRT.json","stocks/CPT.json","stocks/CRH.json","stocks/CRL.json","stocks/CRM.json","stocks/CRWD.json","stocks/CRWV.json","stocks/CSCO.json","stocks/CSGP.json","stocks/CSX.json","stocks/CTAS.json","stocks/CTRA.json","stocks/CTSH.json","stocks/CTVA.json","stocks/CVNA.json","stocks/CVS.json","stocks/CVX.json","stocks/D.json","stocks/DAL.json","stocks/DASH.json","stocks/DAY.json","stocks/DD.json","stocks/DDOG.json","stocks/DE.json","stocks/DECK.json","stocks/DELL.json","stocks/DG.json","stocks/DGX.json","stocks/DHI.json","stocks/DHR.json","stocks/DIS.json","stocks/DLR.json","stocks/DLTR.json","stocks/DOC.json","stocks/DOV.json","stocks/DOW.json","stocks/DPZ.json","stocks/DRI.json","stocks/DTE.json","stocks/DUK.json","stocks/DVA.json","stocks/DVN.json","stocks/DXCM.json","stocks/EA.json","stocks/EBAY.json","stocks/ECHO.json","stocks/ECL.json","stocks/ED.json","stocks/EFX.json","stocks/EG.json","stocks/EIX.json","stocks/EL.json","stocks/ELV.json","stocks/EME.json","stocks/EMR.json","stocks/EOG.json","stocks/EPAM.json","stocks/EQIX.json","stocks/EQR.json","stocks/EQT.json","stocks/ERIE.json","stocks/ES.json","stocks/ESS.json","stocks/ETN.json","stocks/ETR.json","stocks/EVRG.json","stocks/EW.json","stocks/EXC.json","stocks/EXE.json","stocks/EXPD.json","stocks/EXPE.json","stocks/EXR.json","stocks/F.json","stocks/FANG.json","stocks/FAST.json","stocks/FCX.json","stocks/FDS.json","stocks/FDX.json","stocks/FDXF.json","stocks/FE.json","stocks/FER.json","stocks/FERG.json","stocks/FFIV.json","stocks/FICO.json","stocks/FIS.json","stocks/FISV.json","stocks/FITB.json","stocks/FIX.json","stocks/FLEX.json","stocks/FOX.json","stocks/FOXA.json","stocks/FRT.json","stocks/FSLR.json","stocks/FTNT.json","stocks/FTV.json","stocks/GD.json","stocks/GDDY.json","stocks/GE.json","stocks/GEHC.json","stocks/GEN.json","stocks/GEV.json","stocks/GFS.json","stocks/GILD.json","stocks/GIS.json","stocks/GL.json","stocks/GLW.json","stocks/GM.json","stocks/GNRC.json","stocks/GOOG.json","stocks/GOOGL.json","stocks/GPC.json","stocks/GPN.json","stocks/GRMN.json","stocks/GS.json","stocks/GWW.json","stocks/HAL.json","stocks/HAS.json","stocks/HBAN.json","stocks/HCA.json","stocks/HD.json","stocks/HIG.json","stocks/HII.json","stocks/HLT.json","stocks/HOLX.json","stocks/HON.json","stocks/HONA.json","stocks/HOOD.json","stocks/HPE.json","stocks/HPQ.json","stocks/HRL.json","stocks/HSIC.json","stocks/HST.json","stocks/HSY.json","stocks/HUBB.json","stocks/HUM.json","stocks/HWM.json","stocks/IBKR.json","stocks/IBM.json","stocks/ICE.json","stocks/IDXX.json","stocks/IEX.json","stocks/IFF.json","stocks/INCY.json","stocks/INSM.json","stocks/INTC.json","stocks/INTU.json","stocks/INVH.json","stocks/IP.json","stocks/IQV.json","stocks/IR.json","stocks/IRM.json","stocks/ISRG.json","stocks/IT.json","stocks/ITW.json","stocks/IVZ.json","stocks/J.json","stocks/JBHT.json","stocks/JBL.json","stocks/JCI.json","stocks/JKHY.json","stocks/JNJ.json","stocks/JPM.json","stocks/KDP.json","stocks/KEY.json","stocks/KEYS.json","stocks/KHC.json","stocks/KIM.json","stocks/KKR.json","stocks/KLAC.json","stocks/KMB.json","stocks/KMI.json","stocks/KO.json","stocks/KR.json","stocks/KVUE.json","stocks/L.json","stocks/LDOS.json","stocks/LEN.json","stocks/LH.json","stocks/LHX.json","stocks/LII.json","stocks/LIN.json","stocks/LITE.json","stocks/LLY.json","stocks/LMT.json","stocks/LNT.json","stocks/LOW.json","stocks/LRCX.json","stocks/LULU.json","stocks/LUV.json","stocks/LVS.json","stocks/LW.json","stocks/LYB.json","stocks/LYV.json","stocks/MA.json","stocks/MAA.json","stocks/MAR.json","stocks/MAS.json","stocks/MCD.json","stocks/MCHP.json","stocks/MCK.json","stocks/MCO.json","stocks/MDLZ.json","stocks/MDT.json","stocks/MELI.json","stocks/MET.json","stocks/META.json","stocks/MGM.json","stocks/MKC.json","stocks/MLM.json","stocks/MMC.json","stocks/MMM.json","stocks/MNST.json","stocks/MO.json","stocks/MOH.json","stocks/MOS.json","stocks/MPC.json","stocks/MPWR.json","stocks/MRK.json","stocks/MRNA.json","stocks/MRSH.json","stocks/MRVL.json","stocks/MS.json","stocks/MSCI.json","stocks/MSFT.json","stocks/MSI.json","stocks/MSTR.json","stocks/MTB.json","stocks/MTCH.json","stocks/MTD.json","stocks/MU.json","stocks/NBIS.json","stocks/NCLH.json","stocks/NDAQ.json","stocks/NDSN.json","stocks/NEE.json","stocks/NEM.json","stocks/NFLX.json","stocks/NI.json","stocks/NKE.json","stocks/NOC.json","stocks/NOW.json","stocks/NRG.json","stocks/NSC.json","stocks/NTAP.json","stocks/NTRS.json","stocks/NUE.json","stocks/NVDA.json","stocks/NVR.json","stocks/NWS.json","stocks/NWSA.json","stocks/NXPI.json","stocks/O.json","stocks/ODFL.json","stocks/OKE.json","stocks/OMC.json","stocks/ON.json","stocks/ORCL.json","stocks/ORLY.json","stocks/OTIS.json","stocks/OXY.json","stocks/PANW.json","stocks/PAYC.json","stocks/PAYX.json","stocks/PCAR.json","stocks/PCG.json","stocks/PDD.json","stocks/PEG.json","stocks/PEP.json","stocks/PFE.json","stocks/PFG.json","stocks/PG.json","stocks/PGR.json","stocks/PH.json","stocks/PHM.json","stocks/PKG.json","stocks/PLD.json","stocks/PLTR.json","stocks/PM.json","stocks/PNC.json","stocks/PNR.json","stocks/PNW.json","stocks/PODD.json","stocks/POOL.json","stocks/PPG.json","stocks/PPL.json","stocks/PRU.json","stocks/PSA.json","stocks/PSKY.json","stocks/PSX.json","stocks/PTC.json","stocks/PWR.json","stocks/PYPL.json","stocks/Q.json","stocks/QCOM.json","stocks/RCL.json","stocks/REG.json","stocks/REGN.json","stocks/RF.json","stocks/RJF.json","stocks/RKLB.json","stocks/RL.json","stocks/RMD.json","stocks/ROK.json","stocks/ROL.json","stocks/ROP.json","stocks/ROST.json","stocks/RSG.json","stocks/RTX.json","stocks/RVTY.json","stocks/SATS.json","stocks/SBAC.json","stocks/SBUX.json","stocks/SCHW.json","stocks/SHOP.json","stocks/SHW.json","stocks/SJM.json","stocks/SLB.json","stocks/SMCI.json","stocks/SNA.json","stocks/SNDK.json","stocks/SNPS.json","stocks/SO.json","stocks/SOLV.json","stocks/SPCX.json","stocks/SPG.json","stocks/SPGI.json","stocks/SRE.json","stocks/STE.json","stocks/STLD.json","stocks/STT.json","stocks/STX.json","stocks/STZ.json","stocks/SW.json","stocks/SWK.json","stocks/SWKS.json","stocks/SYF.json","stocks/SYK.json","stocks/SYY.json","stocks/T.json","stocks/TAP.json","stocks/TDG.json","stocks/TDY.json","stocks/TEAM.json","stocks/TECH.json","stocks/TEL.json","stocks/TER.json","stocks/TFC.json","stocks/TGT.json","stocks/TJX.json","stocks/TKO.json","stocks/TMO.json","stocks/TMUS.json","stocks/TPL.json","stocks/TPR.json","stocks/TRGP.json","stocks/TRI.json","stocks/TRMB.json","stocks/TROW.json","stocks/TRV.json","stocks/TSCO.json","stocks/TSLA.json","stocks/TSN.json","stocks/TT.json","stocks/TTD.json","stocks/TTWO.json","stocks/TXN.json","stocks/TXT.json","stocks/TYL.json","stocks/UAL.json","stocks/UBER.json","stocks/UDR.json","stocks/UHS.json","stocks/ULTA.json","stocks/UNH.json","stocks/UNP.json","stocks/UPS.json","stocks/URI.json","stocks/USB.json","stocks/V.json","stocks/VEEV.json","stocks/VICI.json","stocks/VLO.json","stocks/VLTO.json","stocks/VMC.json","stocks/VRSK.json","stocks/VRSN.json","stocks/VRT.json","stocks/VRTX.json","stocks/VST.json","stocks/VTR.json","stocks/VTRS.json","stocks/VZ.json","stocks/WAB.json","stocks/WAT.json","stocks/WBD.json","stocks/WDAY.json","stocks/WDC.json","stocks/WEC.json","stocks/WELL.json","stocks/WFC.json","stocks/WM.json","stocks/WMB.json","stocks/WMT.json","stocks/WRB.json","stocks/WSM.json","stocks/WST.json","stocks/WTW.json","stocks/WY.json","stocks/WYNN.json","stocks/XEL.json","stocks/XOM.json","stocks/XYL.json","stocks/XYZ.json","stocks/YUM.json","stocks/ZBH.json","stocks/ZBRA.json","stocks/ZS.json","stocks/ZTS.json"],
    privacy_class: "public",
    source_as_of: { file: "stocks-returns.json", key: "updated" },
    plan: { class_a: 1084, bytes: 17_300_000 },
    policy: { max_assets: 2168, max_total_bytes: 34_500_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "slickcharts-symbols": {
    root: "data/slickcharts",
    manifest_prefix: "public/data/slickcharts",
    files: ["symbols.json","symbols-all.json"],
    privacy_class: "public",
    source_as_of: { file: "symbols.json", key: "updated" },
    plan: { class_a: 10, bytes: 10_900_000 },
    policy: { max_assets: 8, max_total_bytes: 21_700_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "finra-short-volume": {
    root: "data/admin/finra_short_volume",
    files: ["current/regsho_daily.json"],
    privacy_class: "private",
    // The public-safe freshness marker carries the FINRA trade date of the
    // source payload as its top-level source_as_of (never the acquisition
    // time). Non-servable: private family, no ENROLLED_PATHS entry.
    source_as_of: { key: "source_as_of" },
    // Gate declaration: >= 2x the measured 1 PutObject / 398 bytes.
    plan: { class_a: 10, bytes: 1_000 },
    policy: { max_assets: 4, max_total_bytes: 2_000 },
  },
  "finra-ats-weekly": {
    root: "data/admin/finra-ats",
    files: ["current/weekly-summary.json"],
    privacy_class: "private",
    // The weekly marker's top-level source_as_of is the reported week start
    // from the FINRA ATS source payloads themselves. Non-servable: private
    // family, no ENROLLED_PATHS entry.
    source_as_of: { key: "source_as_of" },
    // Gate declaration: >= 2x the measured 1 PutObject / 1,146 bytes.
    plan: { class_a: 10, bytes: 3_000 },
    policy: { max_assets: 4, max_total_bytes: 6_000 },
  },
  "gdelt-news-tone": {
    root: "data/computed",
    files: ["fenok_news_tone_proxy.json"],
    privacy_class: "private",
    // The proxy document's top-level source_as_of is the aggregate floor over
    // GDELT article seendates (min rows[].as_of), never generated_at.
    // Non-servable: private family, no ENROLLED_PATHS entry.
    source_as_of: { key: "source_as_of" },
    // Gate declaration: >= 2x the measured 1 PutObject / 7,068 bytes.
    plan: { class_a: 10, bytes: 15_000 },
    policy: { max_assets: 4, max_total_bytes: 30_000 },
  },
  // Pre-shadow StockAnalysis ETF detail. PRIVATE and deliberately non-servable:
  // a private family is filtered out of the read-side enrolment derivation, so
  // it cannot be half-enrolled by a later edit. There is no manifest_prefix and
  // no files list — this is a tree family over the canonical acquisition root,
  // and the public 1,025-asset shard projection stays exactly where it is,
  // built by sync-public-data and served from static as today.
  "stockanalysis-etf-detail": {
    root: "data/stockanalysis/etfs",
    privacy_class: "private",
    // Truthful tree clock: each enrolled payload contributes either a valid
    // provider source date or, only when it has no source candidate at all, a
    // validated availability-observation date. Per-asset dates are stored in
    // the manifest and the family summary is the conservative MINIMUM. Missing
    // or malformed evidence fails before any write.
    source_as_of: { per_asset_resolver: "stockanalysis_detail_source_timestamp" },
    // Measured 2026-08-16 and re-measured at this base: 5,605 assets /
    // 1,028,334,686 bytes. Caps carry roughly 25% headroom over the measurement
    // so ordinary universe growth does not trip the gate, while a runaway set
    // still fails closed.
    // class_b is declared because a publication of this family READS heavily and
    // those reads were previously invisible to the gate: the adapter issues one
    // presence GET per object key, a readback GET follows every object actually
    // written, and parity re-reads the manifest plus every asset — 16,819 in the
    // all-changed case. 34,000 is >= 2x that measurement, the same safety ratio
    // the class_a and bytes plans already use.
    plan: { class_a: 12_000, class_b: 34_000, bytes: 2_200_000_000 },
    policy: { max_assets: 7_000, max_total_bytes: 1_300_000_000 },
  },
  "yahoo-finance": {
    // Shadow-only first slice. quarter_closes has a different source clock and
    // stays outside this family; _summary is an uncommitted local receipt.
    root: "data/yf/finance",
    manifest_prefix: "public/data/yf/finance",
    exclude: ["_summary.json"],
    reader_enrollment: false,
    privacy_class: "public",
    source_as_of: { per_asset_resolver: "yahoo_finance_source_timestamp" },
    // Measured 2026-08-24: 6,579 tracked payloads / about 326 MB. Plans retain
    // at least 2x write/byte headroom; policy leaves bounded universe growth.
    plan: { class_a: 14_000, class_b: 40_000, bytes: 700_000_000 },
    policy: { max_assets: 8_000, max_total_bytes: 450_000_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return value && typeof value === "object" && !Array.isArray(value)
        && !Object.keys(value).some((key) => /token|secret|password|cookie|authorization|api[_-]?key|credential|private[_-]?key/i.test(key));
    },
  },
  "computed-signals": {
    root: "data/computed",
    manifest_prefix: "public/data/computed",
    files: ["signals.json"],
    privacy_class: "public",
    // The exporter owns this source clock: source_as_of is the conservative
    // minimum of the actual component dates, never generated_at or the
    // publication time.
    source_as_of: { key: "source_as_of" },
    // The current payload is 12,680 bytes. Reuse the existing small computed
    // family bounds with headroom for the one enrolled asset; no new quota
    // mechanism is introduced here.
    plan: { class_a: 10, bytes: 30_000 },
    policy: { max_assets: 4, max_total_bytes: 30_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
  },
  "global-scouter": {
    // The owner-run export is public and reader-enrolled after two successful
    // real generations established a previous-pointer rollback target. The
    // static Git mirror remains the fail-closed LKG whenever the plane cannot
    // resolve an integrity-checked payload.
    root: "data/global-scouter",
    manifest_prefix: "public/data/global-scouter",
    candidate_scope_id: "global_scouter",
    reader_enrollment: true,
    privacy_class: "public",
    // Global Scouter's source clock is the export's provider date, not the
    // converter acquisition timestamp.
    source_as_of: { file: "core/metadata.json", key: "source_date" },
    // Source-change driven, not scheduled, so age carries no signal: an export
    // nobody revised is current, not stale. Freshness asks whether a change is
    // sitting unpublished; the weekday-sized age ceiling is not applied.
    freshness: { mode: "source_change" },
    // The weekly scope moves with the owner export, so tests measure it rather
    // than pinning one week's byte/count fixture. These declarations retain
    // at least 2x headroom for the current candidate and its all-changed read
    // model (presence + readback + parity + resume).
    plan: { class_a: 2_200, class_b: 7_000, bytes: 180_000_000 },
    policy: { max_assets: 1_300, max_total_bytes: 110_000_000 },
    validate_public_payload({ asset, bytes }) {
      const SENSITIVE_KEY = /token|secret|password|cookie|authorization|api[_-]?key|credential|private[_-]?key/i;
      const assetPath = asset?.path;
      if (assetPath === "README.md" || assetPath?.endsWith("/README.md")) {
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          return text.trim().length > 0 && !/(?:^|["'\s])(?:token|secret|password|cookie|authorization|api[_-]?key|credential|private[_-]?key)\s*[:=]/i.test(text);
        } catch {
          return false;
        }
      }
      // Existing family validators are also callable with bytes-only fixtures;
      // an absent asset path therefore means the JSON branch, while any known
      // non-JSON path fails closed.
      if (assetPath !== undefined && !assetPath.endsWith(".json")) return false;
      let value;
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        return false;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
      const stack = [value];
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === null || typeof current !== "object") continue;
        for (const [key, child] of Object.entries(current)) {
          if (SENSITIVE_KEY.test(key)) return false;
          if (child !== null && typeof child === "object") stack.push(child);
        }
      }
      return true;
    },
  },
};

const CONTENT_TYPES = {
  ".json": "application/json",
  ".ndjson": "application/x-ndjson",
  ".csv": "text/csv",
  ".md": "text/markdown",
};

function fail(code, detail) {
  const error = new Error(`${code}:${detail}`);
  error.code = code;
  throw error;
}

// A family that enumerates by directory sweeps in whatever the lane leaves
// there. edgar-korean-summaries has never published because of exactly that:
// its root carries ops/batch-skip-log.jsonl, which is JSONL, and
// validate_public_payload JSON.parses every asset. The repair is to stop
// publishing internal telemetry rather than to weaken a validator that exists
// to keep malformed payloads off the plane for every family.
//
// Rules are root-relative. A rule ending in "/" excludes that directory by path
// SEGMENT, so "ops/" removes ops/... without touching opsimistic/..., and it is
// rooted at the family root rather than matched at any depth. Anything else is
// an exact path. An exclusion that matches nothing, or that would leave no
// assets at all, fails closed - a stale rule sitting quietly is how these lists
// rot.
export function applyFamilyExclusions(files, exclude) {
  if (!exclude || exclude.length === 0) return files;
  const kept = [];
  const used = new Set();
  for (const relative of files) {
    let excluded = false;
    for (const rule of exclude) {
      const hit = rule.endsWith("/")
        ? relative.startsWith(rule)
        : relative === rule;
      if (hit) { excluded = true; used.add(rule); break; }
    }
    if (!excluded) kept.push(relative);
  }
  const unused = exclude.filter((rule) => !used.has(rule));
  if (unused.length > 0) fail("FAMILY_EXCLUDE_UNUSED", unused.join(","));
  if (kept.length === 0) fail("FAMILY_EXCLUDE_EMPTY", exclude.join(","));
  return kept;
}

async function walkFiles(absDir, prefix = "") {
  const entries = await readdir(absDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await walkFiles(path.join(absDir, entry.name), relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

// Candidate scopes are the registry-derived source of truth for large or
// multi-root publications. The publisher intentionally consumes the scope's
// included roots rather than carrying a second hand-written asset list.
async function filesFromCandidateScope({ candidateScopeId, absRoot }) {
  const { manifest } = buildCandidateScope({ repoRoot: REPO_ROOT, candidateId: candidateScopeId });
  const absoluteFamilyRoot = path.resolve(absRoot);
  const files = [];
  for (const included of manifest.included_canonical_roots) {
    const absolute = path.join(REPO_ROOT, included.path);
    const relativeRoot = path.relative(absoluteFamilyRoot, absolute);
    if (!relativeRoot || relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot)) {
      fail("FAMILY_SCOPE_ROOT_INVALID", `${candidateScopeId}: ${included.path} is outside ${absRoot}`);
    }
    const entries = await stat(absolute);
    if (entries.isFile()) {
      files.push(relativeRoot);
    } else if (entries.isDirectory()) {
      const nested = await walkFiles(absolute);
      files.push(...nested.map((relative) => path.join(relativeRoot, relative)));
    } else {
      fail("FAMILY_SCOPE_ROOT_INVALID", `${candidateScopeId}: ${included.path} is not a regular file or directory`);
    }
  }
  return files;
}

// Normalize an as-of value (ISO date-time or ISO date) to the contract's
// "ISO day" form (YYYY-MM-DD). Anything else is invalid.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function isRealIsoDay(value) {
  if (!ISO_DAY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function toIsoDay(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (ISO_DAY.test(trimmed)) return isRealIsoDay(trimmed) ? trimmed : null;
  const dateTime = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
  return dateTime && isRealIsoDay(dateTime[1]) ? dateTime[1] : null;
}

const STOCKANALYSIS_DETAIL_SOURCE_RESOLVER = "stockanalysis_detail_source_timestamp";
const YAHOO_FINANCE_SOURCE_RESOLVER = "yahoo_finance_source_timestamp";
const STOCKANALYSIS_MONTHS = new Map([
  ["jan", 1], ["january", 1],
  ["feb", 2], ["february", 2],
  ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4],
  ["may", 5],
  ["jun", 6], ["june", 6],
  ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8],
  ["sep", 9], ["sept", 9], ["september", 9],
  ["oct", 10], ["october", 10],
  ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12],
]);

function parseStockAnalysisIsoTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const trimmed = value.trim();
  // Python datetime.fromisoformat accepts ISO date-only values and ISO
  // date-times with either T or space separators. Keep the Node branch
  // deliberately narrow so Date.parse does not accept browser-only formats.
  if (!/^\d{4}-\d{2}-\d{2}(?:$|[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)$/.test(trimmed)) {
    return null;
  }
  if (!isRealIsoDay(trimmed.slice(0, 10))) return null;
  // Python treats a timezone-less datetime as UTC in this acquisition path;
  // Date.parse would otherwise interpret it in the Node process timezone.
  const parseValue = trimmed.length > 10
    && !/[zZ]$/.test(trimmed)
    && !/[+-]\d{2}:?\d{2}$/.test(trimmed)
    ? `${trimmed}Z`
    : trimmed;
  const milliseconds = Date.parse(parseValue);
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}

function stockAnalysisCollectionDay(value) {
  const parsed = parseStockAnalysisIsoTimestamp(value);
  if (parsed === null) return null;
  const day = parsed.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return day <= today ? day : null;
}

function stockAnalysisEpochTimestamp(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const seconds = Math.abs(value) >= 100_000_000_000 ? value / 1000 : value;
  const milliseconds = seconds * 1000;
  if (!Number.isFinite(milliseconds)) return null;
  const parsed = new Date(milliseconds);
  if (Number.isNaN(parsed.getTime())) return null;
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
  return parsed.getTime() <= tomorrow ? parsed.toISOString() : null;
}

function stockAnalysisSourceDate(value) {
  const parsed = parseStockAnalysisIsoTimestamp(value);
  if (parsed !== null) return parsed.toISOString().slice(0, 10);
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!match) return null;
  const month = STOCKANALYSIS_MONTHS.get(match[1].toLowerCase());
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month === undefined || !Number.isInteger(day) || !Number.isInteger(year)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
}

function stockAnalysisQuoteSourceDay(quote) {
  if (!quote || typeof quote !== "object" || Array.isArray(quote)) return null;
  const timestamp = stockAnalysisEpochTimestamp(quote.ts);
  const sourceDay = stockAnalysisCollectionDay(quote.td);
  if (timestamp && (!sourceDay || timestamp.slice(0, 10) === sourceDay)) {
    return timestamp.slice(0, 10);
  }
  return sourceDay;
}

function stockAnalysisLatestHistorySourceDay(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const normalized = payload.normalized && typeof payload.normalized === "object"
    ? payload.normalized
    : {};
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const historyPeriods = normalized.history_periods && typeof normalized.history_periods === "object"
    ? normalized.history_periods
    : {};
  const candidates = [normalized.history, historyPeriods.daily_1y, data.history_1y];
  const days = [];
  for (const rows of candidates) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const day = stockAnalysisCollectionDay(row.date || row.t || row.time);
      if (day) days.push(day);
    }
  }
  return days.length > 0 ? days.sort().at(-1) : null;
}

// Mirrors stockanalysis_detail_source_timestamp in fetch-stockanalysis.py.
// The manifest only needs an ISO day, so quote epoch precision is normalized
// after the Python-equivalent priority/fallback decision.
function stockAnalysisHasSourceCandidate(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const raw = payload.raw && typeof payload.raw === "object" ? payload.raw : {};
  const normalized = payload.normalized && typeof payload.normalized === "object"
    ? payload.normalized
    : {};
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const historyPeriods = normalized.history_periods && typeof normalized.history_periods === "object"
    ? normalized.history_periods
    : {};
  const present = (value) => value !== undefined && value !== null && value !== "";
  const quoteCandidate = (quote) => quote
    && typeof quote === "object"
    && !Array.isArray(quote)
    && (present(quote.ts) || present(quote.td));
  return quoteCandidate(raw.quote)
    || quoteCandidate(normalized.quote)
    || present(raw.holdings?.date)
    || present(normalized.holdings_updated)
    || [normalized.history, historyPeriods.daily_1y, data.history_1y]
      .some((rows) => Array.isArray(rows) && rows.length > 0);
}

function stockAnalysisDetailSourceObservation(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const raw = payload.raw && typeof payload.raw === "object" ? payload.raw : {};
  const normalized = payload.normalized && typeof payload.normalized === "object"
    ? payload.normalized
    : {};
  const sourceDay = stockAnalysisQuoteSourceDay(raw.quote)
    || stockAnalysisQuoteSourceDay(normalized.quote)
    || stockAnalysisSourceDate(raw.holdings?.date)
    || stockAnalysisSourceDate(normalized.holdings_updated)
    || stockAnalysisLatestHistorySourceDay(payload);
  if (sourceDay !== null) return { day: sourceDay, origin: "source" };
  // Empty provider stubs are canonical evidence too. They carry no market-data
  // source candidate to date, so fetched_at dates the availability observation
  // itself. Never use this fallback when a candidate was present but malformed:
  // that would turn corruption into apparent freshness.
  if (stockAnalysisHasSourceCandidate(payload)) return null;
  const observationDay = stockAnalysisCollectionDay(payload.fetched_at);
  return observationDay === null
    ? null
    : { day: observationDay, origin: "acquisition-observation" };
}

function yahooFinanceSourceObservation(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const present = (value) => value !== undefined && value !== null && value !== "";
  if (present(payload.source_as_of)) {
    const day = stockAnalysisCollectionDay(payload.source_as_of);
    return day === null ? null : { day, origin: "source" };
  }
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const histories = [data.history_1y, data.history_unadjusted].filter(Array.isArray);
  const historyCandidates = [
    ...(present(payload.history_as_of) ? [payload.history_as_of] : []),
    ...histories.flatMap((rows) => rows.map((row) => row?.date)),
  ];
  const historyDays = historyCandidates.map(stockAnalysisCollectionDay).filter(Boolean).sort();
  const quoteCandidate = present(payload.quote_as_of)
    ? payload.quote_as_of
    : data.info?.regularMarketTime;
  const quoteDay = typeof quoteCandidate === "number"
    ? stockAnalysisEpochTimestamp(quoteCandidate)?.slice(0, 10) ?? null
    : stockAnalysisCollectionDay(quoteCandidate);
  const historyDay = historyDays.at(-1) ?? null;
  if (historyCandidates.length > 0 && historyDay === null) return null;
  if (present(quoteCandidate) && quoteDay === null) return null;
  const sourceDay = historyDay && (!quoteDay || historyDay <= quoteDay) ? historyDay : quoteDay;
  if (sourceDay !== null) return { day: sourceDay, origin: "source" };
  const observationDay = stockAnalysisCollectionDay(payload.fetched_at);
  return observationDay === null
    ? null
    : { day: observationDay, origin: "acquisition-observation" };
}

const PER_ASSET_SOURCE_RESOLVERS = new Map([
  [STOCKANALYSIS_DETAIL_SOURCE_RESOLVER, stockAnalysisDetailSourceObservation],
  [YAHOO_FINANCE_SOURCE_RESOLVER, yahooFinanceSourceObservation],
]);

// Resolve the family's SOURCE time for the manifest's source_as_of field.
//   - { file, key }: read key from the JSON file at <root>/<file>; the value
//     must be date-like (fail FAMILY_ASOF_INVALID otherwise).
//   - { key } (no file): read key from the single enrolled payload (fail
//     FAMILY_ASOF_AMBIGUOUS if the family enrolls more than one file).
//   - { files: { "<rel>": { key } | { max_date: { array, key } } } }:
//     per-file mode — each declared file resolves THAT asset's source date
//     from its own JSON key or maximum row date (array may be null for a
//     top-level row array). Every entry declares exactly one mode; every
//     enrolled asset must be declared and every declared file must be
//     enrolled. Missing or malformed declarations fail loudly (never a
//     created_at fallback).
//     The summary value is the conservative MINIMUM asset date, origin
//     "per-asset" (truthful per-asset labeling, not family-index).
//   - { per_asset_resolver: "stockanalysis_detail_source_timestamp" }:
//     apply the StockAnalysis ETF detail source priority to each enrolled JSON
//     payload. The summary is the conservative MINIMUM. Only a payload with no
//     source candidate at all may use fetched_at as its availability-observation
//     clock; malformed candidates never fall back.
//   - { file, max_date: { array, key } }: take the MAXIMUM normalized key over
//     the named top-level array of the JSON file at <root>/<file> (e.g. the
//     FDIC latest reported quarter). The collection time is never used; a
//     missing file, non-array/empty array, or any element without a valid
//     date fails loudly.
//   - { file, max_date: { array: null, key } }: same as above for a file whose
//     top-level JSON is itself the row array (no named envelope key).
// A declared file ABSENT from the built tree means this family genuinely does
// not provide a source time in this tree (e.g. synthetic offline fixtures) —
// but ONLY in the legacy { file, key } mode does that fall back to the
// manifest created_at, marked "created_at-fallback" so acquisition time is
// never silently blurred into source time. No source_as_of config at all also
// falls back. The per-file and max_date modes never fall back.
// Returns { value, origin } (plus perAsset: Map<relative, isoDay> in per-file
// mode) where origin is "payload" | "family-index" | "per-asset" |
// "payload-max-date" | "created_at-fallback".
export function resolveSourceAsOf({ family, payloads, createdIsoDay, relRoot = null }) {
  const config = family?.source_as_of;
  if (!config) return { value: createdIsoDay, origin: "created_at-fallback" };
  const modes = [
    config.files !== undefined,
    config.max_date !== undefined,
    config.key !== undefined,
    config.per_asset_key !== undefined,
    config.per_asset_resolver !== undefined,
  ].filter(Boolean).length;
  if (modes === 0) {
    fail("FAMILY_ASOF_INVALID", "source_as_of declares no mode: need files, max_date, key, per_asset_key, or per_asset_resolver");
  }
  if (modes > 1) {
    fail("FAMILY_ASOF_INVALID", "source_as_of must declare exactly one mode: files, max_date, key, per_asset_key, or per_asset_resolver");
  }
  const decodeJson = (bytes) => {
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      fail("FAMILY_ASOF_INVALID", `declared source_as_of is not JSON: ${error.message}`);
    }
  };
  const resolveMaxDate = ({ json, maxDate, label }) => {
    const topLevelArray = maxDate?.array === null;
    if (typeof maxDate !== "object" || maxDate === null
      || (typeof maxDate.array !== "string" && !topLevelArray)
      || typeof maxDate.key !== "string") {
      fail(
        "FAMILY_ASOF_INVALID",
        `${label} max_date needs { array: string|null, key: string }`,
      );
    }
    const rows = topLevelArray ? json : json?.[maxDate.array];
    if (!Array.isArray(rows) || rows.length === 0) {
      fail(
        "FAMILY_ASOF_INVALID",
        topLevelArray
          ? `${label} must be a non-empty array`
          : `${label}.${maxDate.array} must be a non-empty array`,
      );
    }
    const values = rows.map((row) => toIsoDay(row?.[maxDate.key]));
    const badIndex = values.findIndex((value) => value === null);
    if (badIndex !== -1) {
      const rowLabel = topLevelArray ? `${label}[${badIndex}]` : `${label}.${maxDate.array}[${badIndex}]`;
      fail(
        "FAMILY_ASOF_INVALID",
        `${rowLabel}.${maxDate.key} is not an ISO date or date-time`,
      );
    }
    return values.sort().at(-1);
  };
  if (config.per_asset_key !== undefined) {
    // Tree mode. Same semantics as the per-file mode — per-asset dates stored,
    // conservative minimum as the family summary — but the asset set comes from
    // the enrolled tree rather than a declared list, because this family has
    // thousands of payloads and enumerating them would be the same hand-written
    // drift the derived bindings just removed.
    if (typeof config.per_asset_key !== "string" || config.per_asset_key.length === 0) {
      fail("FAMILY_ASOF_INVALID", "source_as_of.per_asset_key must be a non-empty string");
    }
    if (!relRoot) {
      fail("FAMILY_ASOF_INVALID", "per-asset-key source_as_of requires a relRoot");
    }
    if (payloads.size === 0) {
      fail("FAMILY_ASOF_INVALID", "per-asset-key source_as_of requires at least one enrolled payload");
    }
    const perAsset = new Map();
    for (const [enrolledPath, bytes] of payloads) {
      // Fail closed rather than falling back to the absolute key: a payload
      // outside the family root means the enrolled set and the declared root
      // disagree, and silently keying such a row would let a foreign path
      // contribute to this family's source clock.
      if (!enrolledPath.startsWith(`${relRoot}/`)) {
        fail(
          "FAMILY_ASOF_INVALID",
          `per-asset-key payload ${enrolledPath} is outside the family root ${relRoot}`,
        );
      }
      const relative = enrolledPath.slice(relRoot.length + 1);
      const json = decodeJson(bytes);
      const raw = json?.[config.per_asset_key];
      const value = toIsoDay(raw);
      if (value === null) {
        fail(
          "FAMILY_ASOF_INVALID",
          `${relative}.${config.per_asset_key} = ${JSON.stringify(raw)} is not an ISO date or date-time`,
        );
      }
      perAsset.set(relative, value);
    }
    const values = [...perAsset.values()].sort();
    return { value: values[0], origin: "per-asset", perAsset };
  }
  if (config.per_asset_resolver !== undefined) {
    const resolveAssetSource = PER_ASSET_SOURCE_RESOLVERS.get(config.per_asset_resolver);
    if (!resolveAssetSource) {
      fail(
        "FAMILY_ASOF_INVALID",
        `unsupported per-asset source_as_of resolver: ${JSON.stringify(config.per_asset_resolver)}`,
      );
    }
    if (!relRoot) {
      fail("FAMILY_ASOF_INVALID", "per-asset resolver source_as_of requires a relRoot");
    }
    if (payloads.size === 0) {
      fail("FAMILY_ASOF_INVALID", "per-asset resolver source_as_of requires at least one enrolled payload");
    }
    const perAsset = new Map();
    let observationFallbackCount = 0;
    for (const [enrolledPath, bytes] of payloads) {
      if (!enrolledPath.startsWith(`${relRoot}/`)) {
        fail(
          "FAMILY_ASOF_INVALID",
          `per-asset resolver payload ${enrolledPath} is outside the family root ${relRoot}`,
        );
      }
      const relative = enrolledPath.slice(relRoot.length + 1);
      const json = decodeJson(bytes);
      const resolved = resolveAssetSource(json);
      if (resolved === null) {
        fail(
          "FAMILY_ASOF_INVALID",
          `${relative} has no valid ${config.per_asset_resolver} source or availability-observation timestamp`,
        );
      }
      if (resolved.origin === "acquisition-observation") observationFallbackCount += 1;
      perAsset.set(relative, resolved.day);
    }
    const values = [...perAsset.values()].sort();
    const origin = observationFallbackCount === 0
      ? "per-asset"
      : observationFallbackCount === perAsset.size
        ? "per-asset-observation"
        : "per-asset-mixed-source-observation";
    return { value: values[0], origin, perAsset, observationFallbackCount };
  }
  if (config.files) {
    if (typeof config.files !== "object" || config.files === null || Array.isArray(config.files)) {
      fail("FAMILY_ASOF_INVALID", "source_as_of.files must be an object mapping file paths to { key }");
    }
    if (Object.keys(config.files).length === 0) {
      fail("FAMILY_ASOF_INVALID", "source_as_of.files must declare at least one file");
    }
    if (!relRoot) {
      fail("FAMILY_ASOF_INVALID", "per-file source_as_of requires a relRoot");
    }
    const perAsset = new Map();
    for (const [relative, entry] of Object.entries(config.files)) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        fail("FAMILY_ASOF_INVALID", `source_as_of.files["${relative}"] must declare key or max_date`);
      }
      const entryModes = [entry.key !== undefined, entry.max_date !== undefined].filter(Boolean).length;
      if (entryModes !== 1) {
        fail("FAMILY_ASOF_INVALID", `source_as_of.files["${relative}"] must declare exactly one of key or max_date`);
      }
      const bytes = payloads.get(`${relRoot}/${relative}`);
      if (!bytes) {
        fail("FAMILY_ASOF_INVALID", `declared source_as_of file ${relative} is not enrolled in this tree`);
      }
      const json = decodeJson(bytes);
      let value;
      if (entry.max_date !== undefined) {
        value = resolveMaxDate({ json, maxDate: entry.max_date, label: relative });
      } else {
        if (typeof entry.key !== "string") {
          fail("FAMILY_ASOF_INVALID", `source_as_of.files["${relative}"].key must be a string`);
        }
        const raw = json?.[entry.key];
        value = toIsoDay(raw);
        if (value === null) {
          fail("FAMILY_ASOF_INVALID", `${relative}.${entry.key} = ${JSON.stringify(raw)} is not an ISO date or date-time`);
        }
      }
      perAsset.set(relative, value);
    }
    const values = [...perAsset.values()].sort();
    return { value: values[0], origin: "per-asset", perAsset };
  }
  if (config.max_date) {
    if (typeof config.file !== "string") {
      fail("FAMILY_ASOF_INVALID", "max_date source_as_of needs a file string");
    }
    const bytes = payloads.get(`${family.manifest_prefix ?? family.root}/${config.file}`);
    if (!bytes) {
      fail("FAMILY_ASOF_INVALID", `declared source_as_of file ${config.file} is not present in this tree`);
    }
    const json = decodeJson(bytes);
    return {
      value: resolveMaxDate({ json, maxDate: config.max_date, label: config.file }),
      origin: "payload-max-date",
    };
  }
  let json;
  let origin;
  if (config.file) {
    const bytes = payloads.get(`${family.manifest_prefix ?? family.root}/${config.file}`);
    if (!bytes) {
      // The family declares a source but this tree does not carry it (for
      // example an offline fixture tree): fall back, explicitly marked.
      return { value: createdIsoDay, origin: "created_at-fallback" };
    }
    json = decodeJson(bytes);
    origin = "family-index";
  } else {
    if (payloads.size !== 1) {
      fail("FAMILY_ASOF_AMBIGUOUS", `source_as_of without a file needs a single enrolled payload (${payloads.size} present)`);
    }
    json = decodeJson(payloads.values().next().value);
    origin = "payload";
  }
  const raw = json?.[config.key];
  const value = toIsoDay(raw);
  if (value === null) {
    fail("FAMILY_ASOF_INVALID", `${config.file ?? "<payload>"}.${config.key} = ${JSON.stringify(raw)} is not an ISO date or date-time`);
  }
  return { value, origin };
}

// Build the generation manifest for a family from the files under absRoot,
// recording asset paths relRoot-relative (they must satisfy the contract's
// privacy prefixes, e.g. "data/" for private, "public/data/" for public).
// Deterministic in content AND persisted metadata: identical file bytes with
// identical metadata always yield the same generation_id, and a metadata-only
// change yields a NEW one (see generationSemanticFingerprint). Enrollment is
// the explicit files argument, else the family descriptor's files list, else
// a recursive walk of absRoot.
//
// Deterministic SEMANTIC generation identity: generation_id must identify the
// PERSISTED manifest semantics, not just the payload bytes. The fingerprint
// covers source_sha (payload-only, the dedupe/parity key) plus every persisted
// per-asset metadata field — path, sha256, bytes, content_type, source_as_of,
// privacy_class — so identical bytes with different metadata (the FRED
// Banking uniform-date -> per-asset-date correction) produce different
// generation ids and therefore a new immutable manifest key. Assets are
// sorted by path inside the fingerprint so the id never depends on caller
// ordering. created_at and other run timestamps are deliberately absent.
// normalizeFallbackSourceAsOf: created_at-fallback families write the run's
// acquisition day into every asset's source_as_of; that dynamic date must not
// churn identity, so it is normalized to null (a contract-legal value) when
// the origin is created_at-fallback. Unchanged fallback content then keeps a
// stable, legacy-equivalent identity across days. All other origins are
// content/config-determined and enter identity as-is.
export function generationSemanticFingerprint({
  sourceSha,
  assets,
  normalizeFallbackSourceAsOf = false,
}) {
  const rows = assets
    .map((asset) => [
      asset.path,
      asset.sha256,
      asset.bytes,
      asset.content_type,
      normalizeFallbackSourceAsOf ? null : asset.source_as_of,
      asset.privacy_class,
    ])
    .sort((left, right) => left[0].localeCompare(right[0]));
  return sha256Canonical([sourceSha, rows]);
}

export async function buildFamilyManifest({
  familyName,
  absRoot,
  relRoot,
  files: explicitFiles = null,
  now = () => new Date().toISOString(),
}) {
  const family = FAMILIES[familyName];
  if (!family) fail("FAMILY_UNKNOWN", familyName);
  const enrolled = explicitFiles ?? family.files ?? (
    family.candidate_scope_id
      ? await filesFromCandidateScope({ candidateScopeId: family.candidate_scope_id, absRoot })
      : null
  );
  // Exclusions apply only to the directory walk: a family that declares an
  // explicit files list has already chosen its assets deliberately.
  const files = (enrolled ?? applyFamilyExclusions(await walkFiles(absRoot), family.exclude))
    .sort((left, right) => left.localeCompare(right));
  if (files.length === 0) fail("FAMILY_EMPTY", absRoot);
  const createdAt = now();
  const createdIsoDay = createdAt.slice(0, 10);
  const payloads = new Map();
  const assets = [];
  for (const relative of files) {
    if (relative.startsWith("/") || relative.includes("\\") || relative.split("/").includes("..")) {
      fail("FAMILY_FILE_INVALID", relative);
    }
    let bytes;
    try {
      bytes = new Uint8Array(await readFile(path.join(absRoot, relative)));
    } catch (error) {
      fail("FAMILY_FILE_MISSING", `${relative} under ${absRoot} (${error.code ?? error.message})`);
    }
    const sha256 = sha256Bytes(bytes);
    const assetPath = `${relRoot}/${relative}`;
    assets.push({
      path: assetPath,
      object_key: `objects/sha256/${sha256}`,
      sha256,
      bytes: bytes.byteLength,
      content_type: CONTENT_TYPES[path.extname(relative).toLowerCase()] ?? "application/octet-stream",
      source_as_of: null, // filled below, after the family source time is resolved
      privacy_class: family.privacy_class,
    });
    payloads.set(assetPath, bytes);
  }
  assets.sort((left, right) => left.path.localeCompare(right.path));
  // The family's SOURCE time (never the acquisition time): real value where
  // the family provides one, created_at fallback otherwise — always with an
  // explicit origin marker so the two are never blurred. Per-file families
  // (fred-banking) resolve EACH asset's own date from its own declared file;
  // the summary value is then the conservative minimum asset date.
  const sourceAsOf = resolveSourceAsOf({ family, payloads, createdIsoDay, relRoot });
  for (const asset of assets) {
    if (sourceAsOf.perAsset) {
      const relative = asset.path.slice(relRoot.length + 1);
      const value = sourceAsOf.perAsset.get(relative);
      if (value === undefined) {
        fail("FAMILY_ASOF_INVALID", `asset ${asset.path} has no declared per-file source_as_of`);
      }
      asset.source_as_of = value;
    } else {
      asset.source_as_of = sourceAsOf.value;
    }
  }
  const sourceSha = sha256Canonical(assets.map((asset) => [asset.path, asset.sha256]));
  const fingerprint = generationSemanticFingerprint({
    sourceSha,
    assets,
    normalizeFallbackSourceAsOf: sourceAsOf.origin === "created_at-fallback",
  });
  const manifest = {
    schema_version: GENERATION_MANIFEST_SCHEMA,
    generation_id: `${familyName}-${fingerprint.slice(0, 16)}`,
    source_sha: sourceSha,
    created_at: createdAt,
    assets,
  };
  const summary = validateGenerationManifest(manifest);
  return { manifest, payloads, summary, sourceAsOf };
}

// The contract's deterministic publish receipt id for a given manifest and
// expected sequence (mirrors deterministicReceiptId in the byte-locked
// contract, which is not exported). Stable across retries of the same logical
// publish as long as the manifest bytes are.
export function deterministicPublishReceiptId({ manifest, expectedPointerSequence }) {
  const summary = validateGenerationManifest(manifest);
  return `publish-${expectedPointerSequence}-${summary.manifest_sha256.slice(0, 32)}`;
}

// Drift guard for the mirror above. Crash-retry depends on the locally
// computed receipt id matching the contract's format; if the contract's
// format ever changes, the ledger lookup would silently miss and crash-retry
// would quietly stop working. Called after every successful publishGeneration
// with the receipt the contract actually returned; a mismatch is a loud
// RECEIPT_ID_DRIFT failure, never a silent fallthrough.
export function assertPublishReceiptId({ manifest, expectedPointerSequence, receipt }) {
  const computed = deterministicPublishReceiptId({ manifest, expectedPointerSequence });
  if (receipt?.receipt_id !== computed) {
    fail(
      "RECEIPT_ID_DRIFT",
      `contract returned receipt_id ${receipt?.receipt_id ?? "<none>"}`
        + ` but deterministic computation gives ${computed}`,
    );
  }
  return computed;
}

// The source_as_of a persisted manifest actually carries: the conservative
// minimum across its assets (uniform families -> that one value; per-asset
// families -> the min; created_at-fallback -> the stored acquisition day).
// Resume/report output MUST read the EFFECTIVE manifest (the one actually
// published or resumed), never the locally rebuilt one: a resumed
// created_at-fallback generation was stored on an earlier day, and claiming
// the local build's newer date would be untruthful.
export function effectiveSourceAsOf(manifest) {
  const values = manifest.assets.map((asset) => asset.source_as_of).sort();
  return values[0];
}

// Fail-closed guard between the locally built manifest and the effective one
// (stored adoption or pointer resume). generation_id equality already implies
// the truncated fingerprint matches; comparing the FULL fingerprint catches an
// impossible divergence — a stale or foreign stored manifest whose id
// collided — before any write or any summary claim. Only created_at and (for
// fallback families) the stored acquisition day may differ; anything else is
// EFFECTIVE_MANIFEST_SEMANTIC_MISMATCH.
export function assertEffectiveManifestSemantics({
  localManifest,
  effectiveManifest,
  normalizeFallbackSourceAsOf = false,
}) {
  const localFingerprint = generationSemanticFingerprint({
    sourceSha: localManifest.source_sha,
    assets: localManifest.assets,
    normalizeFallbackSourceAsOf,
  });
  const effectiveFingerprint = generationSemanticFingerprint({
    sourceSha: effectiveManifest.source_sha,
    assets: effectiveManifest.assets,
    normalizeFallbackSourceAsOf,
  });
  if (localFingerprint !== effectiveFingerprint) {
    fail(
      "EFFECTIVE_MANIFEST_SEMANTIC_MISMATCH",
      `effective manifest ${effectiveManifest.generation_id} diverges from the locally built manifest`,
    );
  }
  return effectiveFingerprint;
}

// Decide the expectedPointerSequence for publishGeneration from the live
// pointer. Normal case: the live sequence (or 0 when no pointer exists).
// Resume case: the pointer already targets this exact generation, so we adopt
// the STORED manifest (byte-identical to what the pointer binds, including the
// original created_at) and pass sequence - 1; the contract then resumes the
// existing receipt through finalizeOrResumePromotion without advancing.
//
// Crash-retry stabilization (both cases): when the manifest object for this
// generation is already stored and binds the same source_sha, it is adopted
// verbatim so a rebuilt manifest with a fresh created_at cannot collide with
// the immutability guard. When the deterministic receipt id for the resolved
// sequence already exists in the ledger (a previous attempt crashed between
// ledger.prepare and compareAndSwap), its created_at is returned as
// resumeCreatedAt so the retried receipt is byte-identical and prepare stays
// idempotent. Without a prior interrupted attempt nothing changes. Because
// crash-retry leans on a local mirror of the contract's (unexported) receipt
// id format, every successful publish is followed by a drift guard
// (assertPublishReceiptId) that fails loudly with RECEIPT_ID_DRIFT if the
// contract's returned receipt_id and the mirror ever diverge.
export async function resolveExpectedPointerSequence({
  pointer,
  manifest,
  objectStore,
  ledger = null,
}) {
  const alreadyActive = pointer
    && pointer.active.generation_id === manifest.generation_id
    && pointer.source_sha === manifest.source_sha;
  const manifestKey = alreadyActive
    ? pointer.active.manifest_key
    : `manifests/${manifest.generation_id}.json`;
  const storedBytes = await objectStore.get(manifestKey);
  let effectiveManifest = manifest;
  if (storedBytes instanceof Uint8Array) {
    if (alreadyActive && sha256Bytes(storedBytes) !== pointer.active.manifest_sha256) {
      fail("STORED_MANIFEST_INTEGRITY", manifestKey);
    }
    const storedManifest = JSON.parse(new TextDecoder().decode(storedBytes));
    const storedSummary = validateGenerationManifest(storedManifest);
    if (
      storedSummary.manifest_sha256 !== sha256Bytes(storedBytes)
      || storedSummary.generation_id !== manifest.generation_id
      || storedManifest.source_sha !== manifest.source_sha
    ) {
      fail("STORED_MANIFEST_CROSS_BIND", manifestKey);
    }
    effectiveManifest = storedManifest;
  } else if (alreadyActive) {
    fail("STORED_MANIFEST_MISSING", manifestKey);
  }
  if (alreadyActive) {
    return {
      manifest: effectiveManifest,
      expectedPointerSequence: pointer.sequence - 1,
      resume: true,
      resumeCreatedAt: null,
    };
  }
  const expectedPointerSequence = pointer?.sequence ?? 0;
  let resumeCreatedAt = null;
  if (ledger) {
    const receiptId = deterministicPublishReceiptId({
      manifest: effectiveManifest,
      expectedPointerSequence,
    });
    const prior = await ledger.get(receiptId);
    if (prior) {
      validatePublicationReceipt(prior);
      const summary = validateGenerationManifest(effectiveManifest);
      if (
        prior.operation !== "publish"
        || prior.generation_id !== effectiveManifest.generation_id
        || prior.manifest_sha256 !== summary.manifest_sha256
        || prior.source_sha !== effectiveManifest.source_sha
        || prior.expected_pointer_sequence !== expectedPointerSequence
      ) {
        fail("RECEIPT_CROSS_BIND", receiptId);
      }
      resumeCreatedAt = prior.created_at;
    }
  }
  return {
    manifest: effectiveManifest,
    expectedPointerSequence,
    resume: false,
    resumeCreatedAt,
  };
}

// Chaos drills, injected only through the publisher's own --chaos flag.
export const CHAOS_MODES = Object.freeze(["stale-sequence", "abort-after-prepare"]);

// stale-sequence: publish with an expectedPointerSequence one behind the live
// pointer value. The contract re-reads the pointer and fails STALE_WRITER
// before any object write or ledger mutation.
export function chaosExpectedPointerSequence({ chaos, pointerSequence, resolved }) {
  if (chaos !== "stale-sequence") return resolved;
  if (!Number.isSafeInteger(pointerSequence) || pointerSequence < 1) {
    fail("CHAOS_PRECONDITION", "stale-sequence requires a live pointer with sequence >= 1");
  }
  return pointerSequence - 1;
}

// abort-after-prepare: wrap the pointerStore so compareAndSwap throws before
// delegating, simulating a crash after ledger.prepare returned. The CAS never
// crosses the wire; the receipt stays in state "prepared".
export function chaosPointerStore({ chaos, pointerStore }) {
  if (chaos !== "abort-after-prepare") return pointerStore;
  return {
    ...pointerStore,
    async compareAndSwap() {
      fail("CHAOS_ABORT_AFTER_PREPARE", "injected crash after ledger.prepare, before compareAndSwap");
    },
  };
}

// Rollback the active pointer to its previous generation via the contract's
// rollbackGeneration. The live pointer is read first and the call is refused
// with ROLLBACK_TARGET_MISSING (the contract's own code for this case) unless
// previous is non-null, so a refusal never reaches a write. The live sequence
// is passed as expectedPointerSequence; rollback moves the sequence forward
// and touches only the coordinator ledger and pointer — no object writes.
export async function rollbackLiveGeneration({
  objectStore,
  ledger,
  pointerStore,
  now,
}) {
  const pointer = await pointerStore.get();
  if (!pointer) {
    fail("ROLLBACK_TARGET_MISSING", "no active pointer — nothing to roll back");
  }
  if (!pointer.previous) {
    fail("ROLLBACK_TARGET_MISSING", "pointer has no previous generation — rollback refused before any write");
  }
  const result = await rollbackGeneration({
    expectedPointerSequence: pointer.sequence,
    objectStore,
    ledger,
    pointerStore,
    now,
  });
  return { pointerBefore: pointer, ...result };
}

// --- retention ----------------------------------------------------------------
//
// computeRetentionPlan is a pure planner: it takes a bucket listing, every
// manifest body, and each family's pointer + prepared-but-unpromoted
// generation names, and decides exactly which objects/sha256/* keys may be
// deleted. Pointers/receipts are per family; the object store is shared, so
// the retained set is per family while the reference union is cross-family.
// It never touches the network, which is what makes the mandated retention
// cases testable offline.

// Keys retention must never collect, whatever the reference scan says.
// MEMBERSHIP RULE (owner mandate): exactly the five P1 live-pilot evidence
// objects and probe/lag.json are protected, and nothing else. A protected key
// needs an owner-named reason to be added — "we were not sure" is not one, and
// the list must never grow by default because an object being collected when
// nothing references it is the system working. Content-addressed probe objects
// (including our Step-0 probe) are deliberately NOT protected.
export const RETENTION_PROTECTED_KEYS = Object.freeze(new Set([
  "manifests/r2-live-pilot-1.json",
  "objects/sha256/32098e38aa809da54d44ca13df2c9031b259c14a1b600a0ef4b5fec7ca65ad8b",
  "objects/sha256/3d55e186eefcfdfd546005031b443221212eb4081b8c7ec279f135a657e531eb",
  "objects/sha256/7893ece3ecba0b3bea4ee13c4d780524f71e8e07f324d918a3c5c2b0c6544946",
  "objects/sha256/c612b423798aa69c3e5bc971d20c9352f11ff41ef8c84cca4d38938a5550e288",
  "probe/lag.json",
]));

export const RETENTION_KEEP_NEWEST = 3;
export const RETENTION_OBJECT_PREFIX = "objects/";
const GENERATION_MANIFEST_KEY = /^manifests\/.+-[0-9a-f]{16}\.json$/;

// manifestEntries: [{key, text|null}] for every manifests/* key in the bucket
// (text null when the object could not be read). objectEntries: [{key, size}]
// for every key in the bucket listing. families: [{ name, pointer,
// preparedGenerations }] — one entry per family, with THAT family's live
// pointer (or null) and the generation ids named by THAT family's receipts in
// state "prepared".
//
// Retained set, PER FAMILY: the keepNewest newest generation manifests of the
// family by created_at, the family's pointer active AND previous generation
// (non-negotiable — the family's rollback target), and the family's prepared-
// but-unpromoted generations. The reference union is then CROSS-FAMILY because
// the object store is shared: an object referenced by any retained manifest of
// any family survives.
//
// Returns { keepNewest, retainedGenerations, retainedByFamily, referencedKeys,
// candidates, skippedProtected, manifestCount }. candidates are
// [{key, size, reason}] sorted by key — the ONLY keys deletion may touch.
// Throws RETENTION_REFERENCE_SET_INCOMPLETE (before any deletion can happen)
// when any manifest is unreadable/corrupt or a retained generation has no
// manifest.
export function computeRetentionPlan({
  families = [],
  manifestEntries = [],
  objectEntries = [],
  keepNewest = RETENTION_KEEP_NEWEST,
  protectedKeys = RETENTION_PROTECTED_KEYS,
}) {
  const generationManifests = []; // [{key, manifest, family}]
  const nonGenerationManifests = []; // aliases / legacy keys: always retained
  for (const entry of manifestEntries) {
    let manifest = null;
    if (typeof entry.text === "string") {
      try {
        manifest = JSON.parse(entry.text);
      } catch {
        manifest = null;
      }
    }
    if (manifest === null) {
      fail("RETENTION_REFERENCE_SET_INCOMPLETE", `${entry.key}: unreadable or not JSON`);
    }
    try {
      validateGenerationManifest(manifest);
    } catch (error) {
      fail("RETENTION_REFERENCE_SET_INCOMPLETE", `${entry.key}: ${error.message}`);
    }
    if (GENERATION_MANIFEST_KEY.test(entry.key) && `manifests/${manifest.generation_id}.json` === entry.key) {
      generationManifests.push({
        key: entry.key,
        manifest,
        family: manifest.generation_id.slice(0, -17), // strip "-<hex16>"
      });
    } else {
      nonGenerationManifests.push({ key: entry.key, manifest });
    }
  }

  const familyStateByName = new Map(families.map((state) => [state.name, state]));
  const familyNames = new Set([
    ...generationManifests.map((entry) => entry.family),
    ...families.map((state) => state.name),
  ]);

  // Newest-N window per family, by created_at (ISO strings sort
  // lexicographically); generation_id breaks ties for determinism.
  const retainedIds = new Set();
  const retainedByFamily = {};
  for (const familyName of [...familyNames].sort()) {
    const ids = new Set();
    const ranked = generationManifests
      .filter((entry) => entry.family === familyName)
      .sort((left, right) => {
        if (left.manifest.created_at !== right.manifest.created_at) {
          return left.manifest.created_at < right.manifest.created_at ? 1 : -1;
        }
        return left.manifest.generation_id < right.manifest.generation_id ? 1 : -1;
      });
    for (const entry of ranked.slice(0, keepNewest)) ids.add(entry.manifest.generation_id);
    const state = familyStateByName.get(familyName);
    for (const id of [
      state?.pointer?.active?.generation_id,
      state?.pointer?.previous?.generation_id,
      ...(state?.preparedGenerations ?? []),
    ]) {
      if (id) ids.add(id);
    }
    retainedByFamily[familyName] = [...ids].sort();
    for (const id of ids) retainedIds.add(id);
  }

  const byGenerationId = new Map(
    generationManifests.map((entry) => [entry.manifest.generation_id, entry.manifest]),
  );
  const retainedManifests = [];
  for (const id of retainedIds) {
    const manifest = byGenerationId.get(id);
    if (!manifest) {
      fail("RETENTION_REFERENCE_SET_INCOMPLETE", `retained generation ${id} has no readable manifest`);
    }
    retainedManifests.push(manifest);
  }
  retainedManifests.push(...nonGenerationManifests.map((entry) => entry.manifest));

  const referencedKeys = new Set();
  for (const manifest of retainedManifests) {
    for (const asset of manifest.assets) referencedKeys.add(asset.object_key);
  }
  // Non-retained manifests still explain WHY a candidate is unreferenced.
  const referencingNonRetained = new Map(); // object_key -> [generation_id]
  for (const { manifest } of generationManifests) {
    if (retainedIds.has(manifest.generation_id)) continue;
    for (const asset of manifest.assets) {
      const list = referencingNonRetained.get(asset.object_key) ?? [];
      list.push(manifest.generation_id);
      referencingNonRetained.set(asset.object_key, list);
    }
  }

  const candidates = [];
  const skippedProtected = [];
  for (const { key, size } of objectEntries) {
    if (protectedKeys.has(key)) {
      skippedProtected.push(key);
      continue;
    }
    if (!key.startsWith(RETENTION_OBJECT_PREFIX)) continue; // manifests, pointers, probe/*: never collected
    if (referencedKeys.has(key)) continue;
    const nonRetained = referencingNonRetained.get(key);
    candidates.push({
      key,
      size: size ?? null,
      reason: nonRetained
        ? `referenced only by non-retained generation(s): ${nonRetained.sort().join(", ")}`
        : "orphaned: no manifest in the bucket references this object",
    });
  }
  candidates.sort((left, right) => left.key.localeCompare(right.key));
  skippedProtected.sort();

  // Manifests are collected under the same single-reference discipline as
  // payloads, added 2026-08-15 by owner decision. Rollback reads only
  // pointer.previous (see rollbackGeneration), so no execution path reads a
  // generation older than N-1, yet manifests were excluded from collection
  // permanently while no budget metric could see them grow.
  //
  // The classifier is deliberately narrower than a manifests/ prefix: an entry
  // qualifies only if it is a valid generation manifest whose key equals
  // manifests/<its own generation_id>.json — the same test that built
  // generationManifests — and whose id is outside the retained set. Every
  // non-generation alias stays in nonGenerationManifests and is never a
  // candidate, and protected keys are excluded here as well as in the payload
  // loop, so neither can be reached by a renamed or spoofed key.
  const sizeByKey = new Map(objectEntries.map(({ key, size }) => [key, size ?? null]));
  const manifestCandidates = generationManifests
    .filter((entry) => !retainedIds.has(entry.manifest.generation_id) && !protectedKeys.has(entry.key))
    .map((entry) => ({
      key: entry.key,
      size: sizeByKey.get(entry.key) ?? null,
      generation_id: entry.manifest.generation_id,
      family: entry.family,
      reason: "generation is outside the retained set: outside the keep-newest window, "
        + "named by no pointer, and held by no prepared receipt",
    }))
    .sort((left, right) => left.key.localeCompare(right.key));

  return {
    keepNewest,
    retainedGenerations: [...retainedIds].sort(),
    retainedByFamily,
    referencedKeys: [...referencedKeys].sort(),
    candidates,
    skippedProtected,
    manifestCount: generationManifests.length + nonGenerationManifests.length,
    manifestCandidates,
    manifestCandidateBytes: manifestCandidates.reduce((total, entry) => total + (entry.size ?? 0), 0),
    manifestBytes: [...generationManifests, ...nonGenerationManifests]
      .reduce((total, entry) => total + (sizeByKey.get(entry.key) ?? 0), 0),
  };
}

// Bucket-level family scan for retention: every family answers with its OWN
// coordinator instance's pointer and prepared-but-unpromoted receipts. A
// family that fails to answer aborts the whole run — an unreadable family is
// indistinguishable from one with no live generations, and guessing wrong
// deletes production data. Success with pointer null (family never published)
// is a legitimate answer and contributes nothing to the retained set.
// The resume window is threaded in rather than defaulted: a prepared receipt has
// no terminal state in the contract, so without a bound it protects its
// generation forever. An absent window aborts before any deletion rather than
// falling back to indefinite protection, which would silently reinstate the
// unbounded case this exists to close.
export async function collectFamiliesRetentionState({ families, createPlane, now, resumeWindowSeconds }) {
  const states = [];
  for (const name of families) {
    let inspection;
    try {
      inspection = await createPlane(name).inspect();
    } catch (error) {
      fail(
        "RETENTION_FAMILY_UNREADABLE",
        `${name}: ${error.code ?? "ERROR"}: ${error.message}`,
      );
    }
    let lifecycle;
    try {
      lifecycle = classifyPreparedReceipts({
        receipts: inspection?.receipts ?? [],
        now,
        resumeWindowSeconds,
      });
    } catch (error) {
      // A classification failure is not a reason to fall back to the old
      // unbounded behaviour; it is a reason to stop before deleting anything.
      fail("RETENTION_RECEIPT_LIFECYCLE_UNRESOLVED", `${name}: ${error.message}`);
    }
    states.push({
      name,
      pointer: inspection?.pointer ?? null,
      // Live only. Pointer active/previous and cross-family manifest references
      // are assembled separately and are unaffected by receipt expiry.
      preparedGenerations: lifecycle.live_generations,
      expiredReceipts: lifecycle.expired_receipts,
      releasedGenerations: lifecycle.released_generations,
      clockAnomalies: lifecycle.clock_anomalies,
      resumeWindowSeconds: lifecycle.resume_window_seconds,
    });
  }
  return states;
}

// Execute an approved plan through an injected deleter (REST live, recording
// stub in tests). Individual delete failures never throw; they are collected
// so one bad key cannot strand the rest of the batch.
export async function executeRetentionPlan({ plan, deleteObject }) {
  const deleted = [];
  const failures = [];
  for (const candidate of plan.candidates) {
    const outcome = await deleteObject(candidate.key);
    if (outcome?.ok === false) {
      failures.push({ key: candidate.key, size: candidate.size, error: outcome.error ?? "delete failed" });
    } else {
      deleted.push({ key: candidate.key, size: candidate.size });
    }
  }
  // Manifests go last, deliberately. A manifest is the only record of which
  // objects a generation held, so deleting it before its payloads would leave a
  // failed payload deletion with nothing left to explain it. Reported as its own
  // class rather than merged into deleted, because a manifest deletion removes
  // evidence while a payload deletion removes data.
  const deletedManifests = [];
  const manifestFailures = [];
  for (const candidate of plan.manifestCandidates ?? []) {
    const outcome = await deleteObject(candidate.key);
    const row = { key: candidate.key, size: candidate.size, generation_id: candidate.generation_id };
    if (outcome?.ok === false) {
      manifestFailures.push({ ...row, error: outcome.error ?? "delete failed" });
    } else {
      deletedManifests.push(row);
    }
  }
  return { deleted, failures, deletedManifests, manifestFailures };
}

// --- result vocabulary + health classifier -----------------------------------
//
// The CLI emits exactly ONE JSON line on stdout per run, with a `result`
// field. The complete set is the vocabulary below; a result outside it (or a
// line that is not JSON, or a missing result) is a BUG, not a known outcome.
// gate_blocked is a known outcome: a blocked cost gate exits 0 by design so it
// cannot fail the lane (git stays authoritative). The chaos results are known
// deliberate outcomes. classifyResultLine gives the workflow step and any
// future monitor the SAME judgement — no grepping for strings on either side.
export const PUBLISH_RESULT_VOCABULARY = Object.freeze([
  "dry_run",
  "published",
  "resumed",
  "gate_blocked",
  "chaos_stale_writer",
  "chaos_abort_after_prepare",
  "rolled_back",
  "retention_dry_run",
  "retention_deleted",
]);

export function classifyResultLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(String(line).trim());
  } catch {
    return { healthy: false, result: null, reason: "not-json" };
  }
  const result = typeof parsed?.result === "string" ? parsed.result : null;
  if (!result) return { healthy: false, result: null, reason: "missing-result" };
  if (!PUBLISH_RESULT_VOCABULARY.includes(result)) {
    return { healthy: false, result, reason: `unknown-result:${result}` };
  }
  return { healthy: true, result, reason: "ok" };
}

// Exit evidence: resolve the active generation through the pointer and compare
// every asset byte-for-byte against the files read from disk.
export async function verifyGenerationParity({ pointerStore, objectStore, payloads }) {
  const pointer = await pointerStore.get();
  if (!pointer) fail("PARITY_POINTER_MISSING", "no active pointer after publish");
  const manifestBytes = await objectStore.get(pointer.active.manifest_key);
  if (
    !(manifestBytes instanceof Uint8Array)
    || sha256Bytes(manifestBytes) !== pointer.active.manifest_sha256
  ) {
    fail("PARITY_MANIFEST_INTEGRITY", pointer.active.manifest_key);
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const summary = validateGenerationManifest(manifest);
  if (
    summary.generation_id !== pointer.active.generation_id
    || summary.manifest_sha256 !== pointer.active.manifest_sha256
    || manifest.source_sha !== pointer.source_sha
  ) {
    fail("PARITY_MANIFEST_CROSS_BIND", pointer.active.manifest_key);
  }
  let bytes = 0;
  await runBoundedAsyncPool(manifest.assets, async (asset) => {
    const stored = await objectStore.get(asset.object_key);
    if (
      !(stored instanceof Uint8Array)
      || stored.byteLength !== asset.bytes
      || sha256Bytes(stored) !== asset.sha256
    ) {
      fail("PARITY_ASSET_INTEGRITY", asset.path);
    }
    const local = payloads.get(asset.path);
    if (
      !(local instanceof Uint8Array)
      || local.byteLength !== stored.byteLength
      || !stored.every((byte, index) => byte === local[index])
    ) {
      fail("PARITY_ASSET_MISMATCH", asset.path);
    }
    bytes += stored.byteLength;
  });
  return { assets: manifest.assets.length, bytes, pointer };
}

// planClassB is required rather than optional-with-a-guess. The gate script has
// always accepted --plan-class-b and folded it into its projection; the
// publisher simply never sent it, so every read a publication performs was
// invisible to the limit check. Callers that genuinely read nothing pass 0
// explicitly — rollback, retention and the post-publish confirmation gates.
function runCostGate({ planClassA, planClassB, planBytes, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      GATE_SCRIPT,
      `--plan-class-a=${planClassA}`,
      `--plan-class-b=${planClassB}`,
      `--plan-bytes=${planBytes}`,
    ], { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({
      code,
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
    }));
  });
}

// The gate answers three different things and used to record two of them the
// same way. "blocked" means it measured a breach; "unverified" means it could
// not measure at all, which was every block in recorded history up to
// 2026-08-21. Both still stop publication - see gateBlocksPublication - but the
// record now says which happened.
export const GATE_MEASUREMENT_UNVERIFIED_EXIT = 3;

export function gateVerdict(gate) {
  if (gate.code === 0) return "ok";
  if (gate.code === 1) return "warn";
  if (gate.code === GATE_MEASUREMENT_UNVERIFIED_EXIT) return "unverified";
  return "blocked";
}

// --- publish-outcome evidence (writer side of the 2026-08-10 contract) ------
//
// Non-blocking per-family outcome recorder: appends one record to
// data/admin/data-supply-state/publish-outcomes/<family>.json for every REAL
// publish outcome (published, resumed, gate_blocked, failed). Dry-run,
// retention (bucket-level, no family) and rollback/chaos-drill modes are not
// publish outcomes and never call this. The write is atomic and additive; a
// shard write failure is logged and returned as {ok:false} WITHOUT changing
// canonical publish behavior (exit code, summary line or result vocabulary).
// `state` carries the run context gathered so far: {generationId, receiptId,
// pointerBefore, pointerAfter, gateBefore, gateAfter, sourceAsOf}.
// The no-write decision is a pure function so the contract is unit-testable:
// only REAL per-family publish runs (no dry-run, no rollback, no chaos drill)
// may record, on every path — gate-blocked, thrown failure or completed
// publish alike.
export function canRecordPublishOutcome({ dryRun, rollback, chaos } = {}) {
  return !dryRun && !rollback && !chaos;
}

export async function recordPublishOutcome({
  family,
  result,
  state = {},
  outcomesRoot = process.env.PUBLISH_OUTCOMES_ROOT
    ? path.resolve(process.env.PUBLISH_OUTCOMES_ROOT)
    : DEFAULT_PUBLISH_OUTCOMES_ROOT,
  log = () => {},
}) {
  try {
    const record = buildPublishOutcomeRecord({
      family,
      result,
      generationId: state.generationId ?? null,
      receiptId: state.receiptId ?? null,
      pointerBefore: state.pointerBefore ?? null,
      pointerAfter: state.pointerAfter ?? null,
      gateBefore: state.gateBefore ?? null,
      gateAfter: state.gateAfter ?? null,
      sourceAsOf: state.sourceAsOf ?? null,
      binding: state.binding ?? null,
    });
    const outcome = await appendPublishOutcome({ outcomesRoot, family, record });
    return { ok: true, count: outcome.count, shardPath: outcome.shardPath, record };
  } catch (error) {
    log(`publish-outcome shard write failed for ${family}: ${error.code ?? "ERROR"}: ${error.message}`);
    return { ok: false, error };
  }
}

// --- retention REST helpers ---------------------------------------------------
// createR2RestBucket (byte-locked lib) maps list() to keys only and has no
// delete; retention needs key+size and DeleteObject, so these two helpers talk
// to the same account-level REST endpoint directly, mirroring the lib's retry
// policy (never retry 4xx; network/5xx get 3 attempts with backoff) and its
// per-attempt deadline over the request AND its body.
const R2_API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const R2_REST_MAX_ATTEMPTS = 3;
const R2_REST_BACKOFF_BASE_MS = 200;
const R2_REST_TIMEOUT_MS = 60_000;

async function r2DataPlaneRequest({ accountId, bucket, token, fetchImpl, method, keyPath, query }) {
  const base = `${R2_API_BASE}/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/objects`;
  const url = `${base}${keyPath ? `/${encodeURIComponent(keyPath)}` : ""}${query ?? ""}`;
  let lastError = null;
  for (let attempt = 1; attempt <= R2_REST_MAX_ATTEMPTS; attempt += 1) {
    // One attempt is the request AND its body under one deadline. fetch
    // resolves as soon as headers arrive, so without this the body had no
    // deadline and no retry: a socket dying mid-body escaped both bounds.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), R2_REST_TIMEOUT_MS);
    let response;
    let body;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      body = await response.arrayBuffer();
    } catch (error) {
      lastError = controller.signal.aborted
        ? new Error(`r2-rest fetch timed out after ${R2_REST_TIMEOUT_MS}ms`)
        : error;
      if (attempt < R2_REST_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, R2_REST_BACKOFF_BASE_MS * 2 ** (attempt - 1)));
      }
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 500 && attempt < R2_REST_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, R2_REST_BACKOFF_BASE_MS * 2 ** (attempt - 1)));
      continue;
    }
    return { response, body };
  }
  fail("R2_REST_NETWORK", lastError?.message ?? "request failed without a response");
}

// Full bucket listing with sizes (the retention report's per-object size).
export async function listR2ObjectsDetailed({ accountId, bucket, token, fetchImpl = fetch }) {
  const objects = [];
  let cursor;
  do {
    const query = `?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const { response, body: responseBody } = await r2DataPlaneRequest({
      accountId, bucket, token, fetchImpl, method: "GET", query,
    });
    if (!response.ok) {
      fail("R2_REST_HTTP", `list http ${response.status}: ${new TextDecoder().decode(responseBody).slice(0, 500)}`);
    }
    const body = JSON.parse(new TextDecoder().decode(responseBody));
    if (!body?.success) {
      fail("R2_REST_HTTP", `list envelope not successful: ${JSON.stringify(body?.errors ?? null)}`);
    }
    for (const object of body.result ?? []) {
      objects.push({ key: object.key, size: object.size ?? null });
    }
    cursor = body?.result_info?.cursor || undefined;
  } while (cursor);
  return objects;
}

// DeleteObject for one key. 404 means the key is already gone, which satisfies
// retention's intent, so it counts as ok. Never throws on an HTTP answer —
// returns {ok:false, error} so executeRetentionPlan can record the failure.
export async function deleteR2Object({ accountId, bucket, token, key, fetchImpl = fetch }) {
  try {
    const { response, body } = await r2DataPlaneRequest({
      accountId, bucket, token, fetchImpl, method: "DELETE", keyPath: key,
    });
    if (response.ok || response.status === 404) return { ok: true };
    return { ok: false, error: `http ${response.status}: ${new TextDecoder().decode(body).slice(0, 500)}` };
  } catch (error) {
    return { ok: false, error: `${error.code ?? "ERROR"}: ${error.message}` };
  }
}

// Gate strictness, exported as two small pure functions so the decision can be
// tested for every (family, gate code) pair without walking a family's payload
// tree. Exit 1 is the gate script's 70% WARN: tolerant families publish through
// it exactly as before, and a strict family treats it as terminal.
export function familyDeclaresStrictGate(familyName) {
  return Boolean(PLANE_PUBLISHER_EXCEPTIONS[familyName]?.strict_gate);
}

// Unchanged on purpose: an unverifiable measurement still blocks, for strict and
// tolerant families alike. Fail-closed is the safe default and relaxing it is an
// owner decision, not a side effect of making the signal honest.
export function gateBlocksPublication({ gateCode, strictGate }) {
  return strictGate ? gateCode !== 0 : (gateCode !== 0 && gateCode !== 1);
}

// Publication admission: FAMILIES and the registry-derived eligible bindings
// must be exactly set-equal. Exported so the focused test can assert both
// mismatch directions without driving a publish.
export function assertPublicationAuthorization({
  families = FAMILIES,
  bindings = PLANE_PUBLISH_OUTCOME_BINDINGS,
} = {}) {
  const declared = new Set(Object.keys(families));
  const eligible = new Set(Object.keys(bindings));
  const unauthorized = [...declared].filter((name) => !eligible.has(name)).sort();
  const unpublishable = [...eligible].filter((name) => !declared.has(name)).sort();
  if (unauthorized.length > 0 || unpublishable.length > 0) {
    const parts = [];
    if (unauthorized.length > 0) {
      parts.push(`publisher families with no registry publish-outcome owner: ${unauthorized.join(", ")}`);
    }
    if (unpublishable.length > 0) {
      parts.push(`registry publish-outcome owners with no publisher family: ${unpublishable.join(", ")}`);
    }
    fail("FAMILY_NOT_AUTHORIZED", `publication authorization mismatch — ${parts.join("; ")}`);
  }
  return { authorized: declared.size };
}

function parseArgs(argv) {
  const args = {
    family: null, dryRun: false, json: false, tolerateGateBlock: false, chaos: null, rollback: false,
    retention: false, retentionDelete: false,
  };
  for (const arg of argv) {
    if (arg.startsWith("--family=")) args.family = arg.slice("--family=".length);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--tolerate-gate-block") args.tolerateGateBlock = true;
    else if (arg === "--rollback") args.rollback = true;
    else if (arg === "--retention") args.retention = true;
    else if (arg === "--retention-delete") args.retentionDelete = true;
    // Owner policy, supplied per run. There is no default: a prepared receipt has
    // no terminal state, so an omitted window would restore indefinite protection.
    else if (arg.startsWith("--prepared-resume-window-seconds=")) {
      args.resumeWindowSeconds = Number.parseInt(arg.slice("--prepared-resume-window-seconds=".length), 10);
    }
    else if (arg.startsWith("--chaos=")) {
      const mode = arg.slice("--chaos=".length);
      if (!CHAOS_MODES.includes(mode)) fail("ARGS_INVALID", `unknown chaos mode ${mode}`);
      args.chaos = mode;
    } else fail("ARGS_INVALID", arg);
  }
  if (!args.retention && !args.family) fail("ARGS_INVALID", "--family=<name> is required");
  if (args.retention && args.family) {
    fail("ARGS_INVALID", "--retention is bucket-level and accepts no --family (the named-family invocation is unsafe)");
  }
  if (args.rollback && args.chaos) fail("ARGS_INVALID", "--rollback cannot be combined with --chaos");
  if (args.retentionDelete && !args.retention) {
    fail("ARGS_INVALID", "--retention-delete requires --retention (dry-run is the default)");
  }
  if (args.retention && (args.chaos || args.rollback)) {
    fail("ARGS_INVALID", "--retention cannot be combined with --chaos or --rollback");
  }
  return args;
}

// Bucket-level retention: dry-run by default. Reads EVERY family's own
// coordinator instance (pointer + prepared receipts), unions the newest-3
// windows across all of them, and collects only objects/sha256/* keys no
// retained manifest of ANY family references. Any family that fails to answer,
// any unreadable manifest, or any retained generation with no manifest aborts
// with zero deletions (RETENTION_REFERENCE_SET_INCOMPLETE /
// RETENTION_FAMILY_UNREADABLE). DeleteObject is free on the free tier, so the
// gate still runs first with a small declaration. --family is deliberately not
// accepted anywhere on this path.
// The resume window is an owner policy value with no safe default, so it arrives
// as an explicit argument and its absence aborts the run before any deletion.
// A default here would silently restore indefinite prepared-receipt protection.
async function runRetention({ tolerateGateBlock, retentionDelete, json, resumeWindowSeconds, now }) {
  const log = (line) => {
    if (!json) console.error(line);
  };
  const emit = (summary) => console.log(JSON.stringify(summary));

  const gateBefore = await runCostGate({ planClassA: 10, planBytes: 0, env: process.env });
  if (gateBefore.stdout.trim()) log(gateBefore.stdout.trim());
  if (gateBefore.code !== 0 && gateBefore.code !== 1) {
    if (gateBefore.stderr.trim()) console.error(gateBefore.stderr.trim());
    if (tolerateGateBlock) {
      emit({ result: "gate_blocked", mode: "retention", gate_exit: gateBefore.code });
      return;
    }
    console.error("publish-cloud-data-generation: cost gate blocked the retention run"
      + ` (exit ${gateBefore.code}); rerun with --tolerate-gate-block to record-and-skip`);
    process.exit(3);
  }

  const token = process.env.CLOUDFLARE_API_TOKEN;
  const endpoint = process.env.DATA_PLANE_ENDPOINT;
  const writeKey = process.env.DATA_PLANE_WRITE_KEY;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? DEFAULT_ACCOUNT_ID;
  const missing = [
    ["CLOUDFLARE_API_TOKEN", token],
    ["DATA_PLANE_ENDPOINT", endpoint],
    ["DATA_PLANE_WRITE_KEY", writeKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    console.error(`publish-cloud-data-generation: missing env ${missing.join(", ")} — no write attempted`);
    process.exit(2);
  }

  const r2Bucket = createR2RestBucket({ accountId, bucket: R2_BUCKET, token });
  // Every family answers from its OWN coordinator instance (the worker route
  // selects it by the x-data-plane-family header). An unreadable family aborts
  // the whole run inside collectFamiliesRetentionState.
  const familiesState = await collectFamiliesRetentionState({
    families: Object.keys(FAMILIES).sort(),
    createPlane: (name) => createCloudflareCloudDataPlane({
      r2Bucket,
      coordinatorNamespace: createRemoteCoordinatorNamespace({ endpoint, key: writeKey, family: name }),
      coordinatorName: name,
    }),
    now,
    resumeWindowSeconds,
  });
  const readObject = async (key) => {
    const entry = await r2Bucket.get(key);
    if (entry === null) return null;
    return new Uint8Array(await entry.arrayBuffer());
  };
  const objectEntries = await listR2ObjectsDetailed({ accountId, bucket: R2_BUCKET, token });
  const manifestEntries = [];
  for (const { key } of objectEntries) {
    if (!key.startsWith("manifests/")) continue;
    const bytes = await readObject(key);
    manifestEntries.push({
      key,
      text: bytes instanceof Uint8Array ? new TextDecoder().decode(bytes) : null,
    });
  }
  const retentionPlan = computeRetentionPlan({
    families: familiesState,
    manifestEntries,
    objectEntries,
  });
  const report = {
    result: retentionDelete ? "retention_deleted" : "retention_dry_run",
    scope: "bucket-level",
    families_scanned: familiesState.map((state) => state.name),
    keep_newest: retentionPlan.keepNewest,
    manifests_read: retentionPlan.manifestCount,
    retained_generations: retentionPlan.retainedGenerations,
    prepared_generations: [...new Set(familiesState.flatMap((state) => state.preparedGenerations))].sort(),
    // Audit only. A released generation is NOT a delete instruction: it merely
    // stops being a protection root, and whether any of its objects are deleted
    // is still decided by the single reference rule. Reported so an operator can
    // see what the window let go of — the point of bounding protection is that
    // the release is visible, not that the candidate set silently widens.
    prepared_receipt_lifecycle: {
      resume_window_seconds: resumeWindowSeconds,
      evaluated_at: now,
      expired_receipts: familiesState.flatMap((state) => (state.expiredReceipts ?? []).map((row) => ({ family: state.name, ...row }))),
      released_generations: [...new Set(familiesState.flatMap((state) => state.releasedGenerations ?? []))].sort(),
      clock_anomalies: familiesState.flatMap((state) => (state.clockAnomalies ?? []).map((row) => ({ family: state.name, ...row }))),
    },
    referenced_object_count: retentionPlan.referencedKeys.length,
    protected_keys_present: retentionPlan.skippedProtected,
    candidate_count: retentionPlan.candidates.length,
    candidate_bytes: retentionPlan.candidates.reduce((total, candidate) => total + (candidate.size ?? 0), 0),
    candidates: retentionPlan.candidates,
    // Manifest terms are reported separately from payload terms because no
    // budget metric measures manifests at all: neither count nor bytes reaches
    // the storage slots calculation, so this report is the only place their
    // growth is visible until a metric exists. Kept distinct rather than summed,
    // since a manifest deletion removes evidence and a payload deletion removes
    // data, and an operator needs to see which happened.
    manifest_bytes: retentionPlan.manifestBytes,
    manifest_candidate_count: retentionPlan.manifestCandidates.length,
    manifest_candidate_bytes: retentionPlan.manifestCandidateBytes,
    manifest_candidates: retentionPlan.manifestCandidates,
    gate_before: gateVerdict(gateBefore),
  };
  if (retentionDelete) {
    const executed = await executeRetentionPlan({
      plan: retentionPlan,
      deleteObject: (key) => deleteR2Object({ accountId, bucket: R2_BUCKET, token, key }),
    });
    report.deleted = executed.deleted;
    report.deleted_count = executed.deleted.length;
    report.delete_failures = executed.failures;
    // Durable record of which manifests were removed. Once a manifest is gone
    // its objects can only ever be reported as orphaned, so this list is the
    // only thing that keeps that reason attributable afterwards.
    report.deleted_manifests = executed.deletedManifests;
    report.deleted_manifest_count = executed.deletedManifests.length;
    report.deleted_manifest_bytes = executed.deletedManifests
      .reduce((total, row) => total + (row.size ?? 0), 0);
    report.manifest_delete_failures = executed.manifestFailures;
    emit(report);
    const failureCount = executed.failures.length + executed.manifestFailures.length;
    if (failureCount > 0) {
      fail("RETENTION_DELETE_FAILED", `${failureCount} object(s) could not be deleted`);
    }
    return;
  }
  emit(report); // dry-run: zero deletions, always exit 0
}

function createDefaultPublishPlane({ accountId, token, endpoint, writeKey, family }) {
  const r2Bucket = createR2RestBucket({ accountId, bucket: R2_BUCKET, token });
  let objectsWritten = 0;
  const countingR2Bucket = {
    ...r2Bucket,
    async put(key, bytes) {
      await r2Bucket.put(key, bytes);
      objectsWritten += 1;
    },
  };
  const coordinatorNamespace = createRemoteCoordinatorNamespace({ endpoint, key: writeKey, family });
  return {
    plane: createCloudflareCloudDataPlane({
      r2Bucket: countingR2Bucket,
      coordinatorNamespace,
      coordinatorName: family,
    }),
    objectsWritten: () => objectsWritten,
  };
}

export async function runPublisherCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = (line) => console.log(line),
  stderr = (...parts) => console.error(...parts),
  runCostGateImpl = runCostGate,
  createPublishPlaneImpl = createDefaultPublishPlane,
  outcomesRoot = env.PUBLISH_OUTCOMES_ROOT
    ? path.resolve(env.PUBLISH_OUTCOMES_ROOT)
    : DEFAULT_PUBLISH_OUTCOMES_ROOT,
} = {}) {
  const args = parseArgs(argv);
  // Publication admission is NOT called here. It gates publication and dry-run
  // only, from inside the try below, after retention and rollback have had
  // their chance to return. Gating every mode would have made recovery depend
  // on an unrelated registry mismatch, which is the opposite of what a rollback
  // path is for. The failure it does prevent is a family that exists only in
  // FAMILIES: the publisher would publish it and no lane would own, stage or
  // land its outcome.
  const log = (...parts) => {
    if (!args.json) stderr(...parts);
  };
  const emit = (summary) => stdout(JSON.stringify(summary));
  const evidenceLog = (...parts) => stderr(...parts);

  // Retention is bucket-level, not family-level: it scans EVERY family and
  // deliberately accepts no --family (parseArgs rejects the combination).
  if (args.retention) {
    await runRetention({
      tolerateGateBlock: args.tolerateGateBlock,
      retentionDelete: args.retentionDelete,
      json: args.json,
      resumeWindowSeconds: args.resumeWindowSeconds,
      now: new Date().toISOString(),
    });
    return 0;
  }

  const family = FAMILIES[args.family];
  if (!family) {
    stderr(`publish-cloud-data-generation: unknown family ${args.family}`
      + ` (known: ${Object.keys(FAMILIES).join(", ")})`);
    return 2;
  }

  // Publish-outcome evidence (2026-08-10 contract): every REAL publish
  // outcome — published, resumed, gate_blocked, failed — appends one record
  // to data/admin/data-supply-state/publish-outcomes/<family>.json. Dry-run
  // writes no shard; rollback and the known chaos-drill outcomes are not
  // publish outcomes and write nothing. The shard write is non-blocking: a
  // failure is logged and reported (outcome_shard in the summary) but never
  // changes the publish's exit code, summary line or result vocabulary.
  const outcomeState = {
    family: args.family,
    generationId: null,
    receiptId: null,
    pointerBefore: null,
    pointerAfter: null,
    gateBefore: null,
    gateAfter: null,
    sourceAsOf: null,
    // Joined-cycle tuple. The publisher can only see the legs that exist at
    // write time: the Git commit and acquisition artifact it was handed, and
    // the content identity of the tree it is publishing. origin_readback is
    // deliberately left null here and completed by the persist step, which is
    // the step that actually reads current origin.
    binding: null,
  };
  // The two identity legs are read from the INJECTED env and bound BEFORE
  // admission, so an outcome that never reaches a manifest — a gate refusal,
  // an admission mismatch, a thrown failure — still records WHICH artifact it
  // refused. Binding only on the success path would leave exactly the outcomes
  // worth investigating unattributable.
  const bindingIdentity = {
    gitCommit: env.PUBLISH_BINDING_GIT_COMMIT || null,
    artifactDigest: env.PUBLISH_BINDING_ARTIFACT_DIGEST || null,
  };
  outcomeState.binding = buildPublishOutcomeBinding(bindingIdentity);
  const recordOutcome = (result) => recordPublishOutcome({
    family: args.family,
    result,
    state: outcomeState,
    outcomesRoot,
    // Evidence persistence failures are operationally material even in JSON
    // mode. Keep stdout machine-clean and put the bounded diagnostic on stderr.
    log: evidenceLog,
  });
  // Dry-run, rollback and the deliberate chaos-drill modes never record
  // (dry-run writes no shard; rollback is not a publish; chaos outcomes are
  // injected drills, not real publishes — including their gate-blocked and
  // thrown-failure paths). Retention already returned above.
  const canRecordOutcome = canRecordPublishOutcome(args);
  const shardSummary = (outcome) => outcome.ok
    ? { ok: true }
    : { ok: false, error: outcome.error?.message ?? String(outcome.error) };

  try {
    // 0. Rollback stands alone and runs FIRST. It is pointer-authority-only: it
    // performs ZERO object writes and reads no LOCAL payload, so it must not
    // depend on the raw Git tree still being present, nor on the publisher and
    // registry sets agreeing with each other. It DOES perform remote
    // verification reads — the previous manifest and every payload that manifest
    // names are fetched and validated before the pointer moves — and those reads
    // are declared to the gate below rather than pretended away.
    // That independence is the entire point: recovery has to outlive both an
    // unrelated authority mismatch and the eventual retirement of the canonical
    // tree. Publication and dry-run stay admission-gated below.
    if (args.rollback) {
      const rollbackToken = env.CLOUDFLARE_API_TOKEN;
      const rollbackEndpoint = env.DATA_PLANE_ENDPOINT;
      const rollbackWriteKey = env.DATA_PLANE_WRITE_KEY;
      const rollbackAccountId = env.CLOUDFLARE_ACCOUNT_ID ?? DEFAULT_ACCOUNT_ID;
      // Rollback writes no object, but it is NOT read-free: rollbackLiveGeneration
      // fetches the previous manifest and then every payload it names in order to
      // validate them before the pointer moves. Declaring 0 here was false. The
      // ceiling is derived from the family's own declared policy rather than from
      // the local tree, so it stays honest without reading anything: one manifest
      // plus max_assets payloads, doubled for the same >=2x margin every other
      // plan in this file uses. For the ETF family that is 2 * (7,000 + 1) = 14,002.
      const rollbackReadCeiling = 2 * ((family.policy?.max_assets ?? 0) + 1);
      const rollbackGateBefore = await runCostGateImpl({
        planClassA: 10,
        planClassB: rollbackReadCeiling,
        planBytes: 0,
        env,
      });
      if (!args.json && rollbackGateBefore.stdout.trim()) stderr(rollbackGateBefore.stdout.trim());
      if (rollbackGateBefore.code !== 0 && rollbackGateBefore.code !== 1) {
        if (rollbackGateBefore.stderr.trim()) stderr(rollbackGateBefore.stderr.trim());
        if (args.tolerateGateBlock) {
          emit({ result: "gate_blocked", mode: "rollback", gate_exit: rollbackGateBefore.code });
          return 0;
        }
        stderr("publish-cloud-data-generation: cost gate blocked the rollback"
          + ` (exit ${rollbackGateBefore.code}); rerun with --tolerate-gate-block to record-and-skip`);
        return 3;
      }
      const rollbackMissing = [
        ["CLOUDFLARE_API_TOKEN", rollbackToken],
        ["DATA_PLANE_ENDPOINT", rollbackEndpoint],
        ["DATA_PLANE_WRITE_KEY", rollbackWriteKey],
      ].filter(([, value]) => !value).map(([name]) => name);
      if (rollbackMissing.length) {
        stderr(`publish-cloud-data-generation: missing env ${rollbackMissing.join(", ")} — no rollback attempted`);
        return 2;
      }
      const { plane: rollbackPlane } = createPublishPlaneImpl({
        accountId: rollbackAccountId,
        token: rollbackToken,
        endpoint: rollbackEndpoint,
        writeKey: rollbackWriteKey,
        family: args.family,
      });
      const rolled = await rollbackLiveGeneration({
        objectStore: rollbackPlane.objectStore,
        ledger: rollbackPlane.ledger,
        pointerStore: rollbackPlane.pointerStore,
      });
      const rollbackPointerAfter = await rollbackPlane.pointerStore.get();
      const rollbackGateAfter = await runCostGateImpl({ planClassA: 0, planClassB: 0, planBytes: 0, env });
      emit({
        result: "rolled_back",
        receipt_id: rolled.receipt.receipt_id,
        receipt_state: rolled.receipt.state,
        pointer_sequence_before: rolled.pointerBefore.sequence,
        pointer_sequence_after: rollbackPointerAfter?.sequence ?? null,
        active_generation_before: rolled.pointerBefore.active.generation_id,
        previous_generation_before: rolled.pointerBefore.previous?.generation_id ?? null,
        active_generation_after: rollbackPointerAfter?.active.generation_id ?? null,
        previous_generation_after: rollbackPointerAfter?.previous?.generation_id ?? null,
        objects_written: 0,
        gate_before: gateVerdict(rollbackGateBefore),
        gate_after: gateVerdict(rollbackGateAfter),
      });
      return 0;
    }

    // Publication and dry-run only: both write or plan a write against the
    // declared family set, so both require FAMILIES and the registry-derived
    // eligible bindings to be exactly set-equal. Retention returned above and
    // rollback returned just now; neither is admission-gated.
    assertPublicationAuthorization();

    // 1. Manifest from disk.
    const { manifest, payloads, summary, sourceAsOf } = await buildFamilyManifest({
      familyName: args.family,
      absRoot: path.join(REPO_ROOT, family.root),
      relRoot: family.manifest_prefix ?? family.root,
    });
    outcomeState.generationId = manifest.generation_id;
    outcomeState.sourceAsOf = sourceAsOf.value;
    // Bind the tree being published to the Git commit and acquisition artifact
    // it came from. Both identities are supplied by the caller because only
    // the caller knows them: inside this job the checkout has been reset to
    // origin/main, so the ambient run commit is not the published tree's
    // commit. Absent env leaves the leg null rather than guessing.
    //
    // Enrich the pre-admission identity with the scope of the tree actually
    // being published. The identity legs are carried forward unchanged rather
    // than re-read, so the tuple cannot describe one artifact before admission
    // and a different one after it.
    outcomeState.binding = buildPublishOutcomeBinding({
      ...bindingIdentity,
      scopeSourceSha256: manifest.source_sha,
      scopeFileCount: summary.asset_count,
      scopeBytes: summary.total_bytes,
    });
    const uniqueAssetKeys = new Set(manifest.assets.map((asset) => asset.object_key)).size;
    const plan = {
      assets: summary.asset_count,
      total_bytes: summary.total_bytes,
      unique_object_keys: uniqueAssetKeys + 1, // + manifest object
      objects_deduped: summary.asset_count - uniqueAssetKeys,
    };
    log(`family ${args.family}: ${plan.assets} assets, ${plan.total_bytes} bytes,`
      + ` ${plan.unique_object_keys} unique objects (${plan.objects_deduped} deduped)`
      + ` -> generation ${manifest.generation_id}`);

    if (args.dryRun && !args.retention) {
      emit({
        result: "dry_run",
        generation_id: manifest.generation_id,
        source_as_of: sourceAsOf.value,
        source_as_of_origin: sourceAsOf.origin,
        ...(sourceAsOf.observationFallbackCount !== undefined
          ? { source_as_of_observation_fallbacks: sourceAsOf.observationFallbackCount }
          : {}),
        ...plan,
        // Explicit-enrollment families also list each enrolled asset; tree
        // families (oecd-cli) keep the original summary shape byte-identical.
        ...(family.files || family.candidate_scope_id
          ? {
            enrolled: manifest.assets.map((asset) => ({
              path: asset.path,
              bytes: asset.bytes,
              privacy_class: asset.privacy_class,
            })),
          }
          : {}),
        planned_class_a: family.plan.class_a,
        // Audit symmetry: the dry-run summary now reports the read plan the gate
        // would receive, so a reviewer can see all three declared dimensions
        // without running the publication.
        planned_class_b: family.plan.class_b ?? 0,
        planned_bytes: family.plan.bytes,
        gate: "not_run",
      });
      return 0;
    }

    // 2. Cost gate (declares >= 2x the real spend) before any write. Rollback
    // touches only the coordinator (DeleteObject is free on the free tier, so
    // retention declares a small but still generous plan) — the gate runs first
    // in every mode.
    // class_b defaults to 0 for the families that predate this field, which
    // preserves their gate arithmetic exactly; a family that declares reads
    // declares them here.
    const gatePlan = family.plan;
    const gateBefore = await runCostGateImpl({
      planClassA: gatePlan.class_a,
      planClassB: gatePlan.class_b ?? 0,
      planBytes: gatePlan.bytes,
      env,
    });
    outcomeState.gateBefore = gateVerdict(gateBefore);
    if (!args.json && gateBefore.stdout.trim()) {
      stderr(gateBefore.stdout.trim());
    }
    // Gate strictness is per family and declared in the registry. Tolerant
    // families keep exactly their existing behaviour, where exit 1 is the
    // script's 70% WARN and publication proceeds. A strict family treats ANY
    // nonzero code as a block — the 70% warn is already tighter than the
    // owner's 80% stop, and for the first publication of the largest payload in
    // the estate the conservative reading is the correct one. Strictness also
    // ignores --tolerate-gate-block, so a manual dispatch cannot reintroduce
    // the false green the flag would produce. Either way this returns before
    // the env check and before any plane is created, so a blocked gate performs
    // no remote call, while the gate_blocked evidence is still recorded.
    const strictGate = familyDeclaresStrictGate(args.family);
    const gateBlocked = gateBlocksPublication({ gateCode: gateBefore.code, strictGate });
    if (gateBlocked) {
      if (gateBefore.stderr.trim()) stderr(gateBefore.stderr.trim());
      const outcomeShard = canRecordOutcome ? await recordOutcome("gate_blocked") : null;
      if (args.tolerateGateBlock && !strictGate) {
        emit({
          result: "gate_blocked",
          mode: args.retention ? "retention" : "publish",
          generation_id: manifest.generation_id,
          gate_exit: gateBefore.code,
          ...plan,
          ...(outcomeShard ? { outcome_shard: shardSummary(outcomeShard) } : {}),
        });
        return 0;
      }
      stderr("publish-cloud-data-generation: cost gate blocked the publish"
        + ` (exit ${gateBefore.code})`
        + (strictGate
          ? "; this family declares strict_gate, so any nonzero verdict is terminal"
          : "; rerun with --tolerate-gate-block to record-and-skip"));
      return 3;
    }

    // Env for the live write, checked after the gate and before any write.
    const token = env.CLOUDFLARE_API_TOKEN;
    const endpoint = env.DATA_PLANE_ENDPOINT;
    const writeKey = env.DATA_PLANE_WRITE_KEY;
    const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? DEFAULT_ACCOUNT_ID;
    const missing = [
      ["CLOUDFLARE_API_TOKEN", token],
      ["DATA_PLANE_ENDPOINT", endpoint],
      ["DATA_PLANE_WRITE_KEY", writeKey],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) {
      // Record the failed outcome before the direct exit so the alarm side
      // still sees it (the lane could not publish).
      if (canRecordOutcome) await recordOutcome("failed");
      stderr(`publish-cloud-data-generation: missing env ${missing.join(", ")} — no write attempted`);
      return 2;
    }

    // Rollback mode: pointer-only change through the contract's
    // rollbackGeneration; the summary records the sequence and both generation
    // ids before and after, because rollback moves the sequence FORWARD.
    // 3. Publish through the REST R2 bridge + remote coordinator shim.
    const publishPlane = createPublishPlaneImpl({
      accountId, token, endpoint, writeKey, family: args.family,
    });
    const { plane } = publishPlane;
    const livePointer = await plane.pointerStore.get();
    const pointerSequenceBefore = livePointer?.sequence ?? 0;
    outcomeState.pointerBefore = pointerSequenceBefore;
    const resolved = await resolveExpectedPointerSequence({
      pointer: livePointer,
      manifest,
      objectStore: plane.objectStore,
      ledger: plane.ledger,
    });
    // Semantic identity guard + truthful metadata: the effective manifest
    // (stored adoption / pointer resume) must carry the SAME persisted
    // metadata the local build fingerprints — an impossible divergence fails
    // closed before any write or summary claim. The reported source_as_of is
    // read from the EFFECTIVE manifest, never the local rebuild (a resumed
    // created_at-fallback generation was stored on an earlier day).
    assertEffectiveManifestSemantics({
      localManifest: manifest,
      effectiveManifest: resolved.manifest,
      normalizeFallbackSourceAsOf: sourceAsOf.origin === "created_at-fallback",
    });
    const effectiveAsOf = effectiveSourceAsOf(resolved.manifest);
    outcomeState.sourceAsOf = effectiveAsOf;
    if (args.chaos === "stale-sequence" && resolved.resume) {
      fail("CHAOS_PRECONDITION", "stale-sequence needs a generation the pointer does not already target");
    }
    const expectedForPublish = chaosExpectedPointerSequence({
      chaos: args.chaos,
      pointerSequence: pointerSequenceBefore,
      resolved: resolved.expectedPointerSequence,
    });
    const publishPointerStore = chaosPointerStore({
      chaos: args.chaos,
      pointerStore: plane.pointerStore,
    });
    const policy = {
      max_assets: family.policy.max_assets,
      max_total_bytes: family.policy.max_total_bytes,
      validate_freshness: () => true,
      // The contract invokes this on every public asset before writing;
      // public families must provide a real validator in the descriptor.
      validate_public_payload: family.validate_public_payload ?? (() => true),
    };
    let published;
    try {
      published = await publishGeneration({
        manifest: resolved.manifest,
        payloads,
        expectedPointerSequence: expectedForPublish,
        objectStore: plane.objectStore,
        ledger: plane.ledger,
        pointerStore: publishPointerStore,
        policy,
        now: resolved.resumeCreatedAt ? () => resolved.resumeCreatedAt : undefined,
      });
    } catch (error) {
      if (args.chaos === "stale-sequence" && error.code === "STALE_WRITER") {
        const pointerNow = await plane.pointerStore.get();
        const gateAfter = await runCostGateImpl({ planClassA: 0, planClassB: 0, planBytes: 0, env });
        emit({
          result: "chaos_stale_writer",
          chaos: args.chaos,
          error_code: error.code,
          generation_id: manifest.generation_id,
          attempted_expected_sequence: expectedForPublish,
          pointer_sequence_before: pointerSequenceBefore,
          pointer_sequence_after: pointerNow?.sequence ?? 0,
          gate_before: gateVerdict(gateBefore),
          gate_after: gateVerdict(gateAfter),
        });
        return 0;
      }
      if (args.chaos === "abort-after-prepare" && error.code === "CHAOS_ABORT_AFTER_PREPARE") {
        const receiptId = deterministicPublishReceiptId({
          manifest: resolved.manifest,
          expectedPointerSequence: resolved.expectedPointerSequence,
        });
        const receipt = await plane.ledger.get(receiptId);
        const pointerNow = await plane.pointerStore.get();
        const gateAfter = await runCostGateImpl({ planClassA: 0, planClassB: 0, planBytes: 0, env });
        emit({
          result: "chaos_abort_after_prepare",
          chaos: args.chaos,
          error_code: error.code,
          generation_id: manifest.generation_id,
          receipt_id: receiptId,
          receipt_state: receipt?.state ?? null,
          pointer_sequence_before: pointerSequenceBefore,
          pointer_sequence_after: pointerNow?.sequence ?? 0,
          gate_before: gateVerdict(gateBefore),
          gate_after: gateVerdict(gateAfter),
        });
        return 0;
      }
      throw error;
    }
    // Drift guard (only reached on a successful publish): the receipt id the
    // contract actually returned must equal our deterministic mirror of its
    // format. A mismatch means the contract's format changed and crash-retry
    // would silently miss — fail loudly before any summary claims success.
    assertPublishReceiptId({
      manifest: resolved.manifest,
      expectedPointerSequence: expectedForPublish,
      receipt: published.receipt,
    });
    outcomeState.receiptId = published.receipt.receipt_id;
    outcomeState.pointerAfter = published.pointer.sequence;
    log(`${resolved.resume ? "resumed" : "published"} generation ${manifest.generation_id}:`
      + ` pointer ${pointerSequenceBefore} -> ${published.pointer.sequence},`
      + ` receipt ${published.receipt.receipt_id} (${published.receipt.state})`);

    // 4. Parity verification, resolved through the pointer ourselves.
    const parity = await verifyGenerationParity({
      pointerStore: plane.pointerStore,
      objectStore: plane.objectStore,
      payloads,
    });
    log(`byte parity ok: ${parity.assets}/${parity.assets} assets, ${parity.bytes} bytes`);

    // 5. Gate again after the write batch, then the single JSON summary line.
    const gateAfter = await runCostGateImpl({ planClassA: 0, planClassB: 0, planBytes: 0, env });
    outcomeState.gateAfter = gateVerdict(gateAfter);
    const outcomeShard = await recordOutcome(resolved.resume ? "resumed" : "published");
    emit({
      result: resolved.resume ? "resumed" : "published",
      generation_id: manifest.generation_id,
      source_sha: manifest.source_sha,
      source_as_of: effectiveAsOf,
      source_as_of_origin: sourceAsOf.origin,
      ...(sourceAsOf.observationFallbackCount !== undefined
        ? { source_as_of_observation_fallbacks: sourceAsOf.observationFallbackCount }
        : {}),
      receipt_id: published.receipt.receipt_id,
      receipt_state: published.receipt.state,
      pointer_sequence_before: pointerSequenceBefore,
      pointer_sequence_after: published.pointer.sequence,
      ...plan,
      objects_written: publishPlane.objectsWritten(),
      objects_already_present: plan.unique_object_keys - publishPlane.objectsWritten(),
      parity: "ok",
      gate_before: gateVerdict(gateBefore),
      gate_after: gateVerdict(gateAfter),
      outcome_shard: shardSummary(outcomeShard),
    });
    return 0;
  } catch (error) {
    // Every failed REAL publish outcome is recorded when the family is known
    // (dry-run and rollback excluded); the canonical failure path (rethrow,
    // stderr line, exit 1) is unchanged.
    if (canRecordOutcome) await recordOutcome("failed");
    stderr(`publish-cloud-data-generation: ${error.code ?? "ERROR"}: ${error.message}`);
    return 1;
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    process.exitCode = await runPublisherCli();
  } catch (error) {
    console.error(`publish-cloud-data-generation: ${error.code ?? "ERROR"}: ${error.message}`);
    process.exitCode = 1;
  }
}
