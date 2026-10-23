#!/usr/bin/env bash
set -euo pipefail

bash scripts/load-guard.sh --assert-nested
repo_root="$(git rev-parse --show-toplevel)"

# A code-only checkout is not a health snapshot. Restore the active inputs
# through the same read-only materializer used by Update Manifest.
node --input-type=module <<'JS'
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { DATA_SUPPLY_DETECTION_CONFIG } from '../scripts/lib/data-supply-detection-config.mjs';
import { LANE_REGISTRY } from '../scripts/lib/lane-registry.mjs';
import { createDefaultMaterializePlane, materializeCloudDataPlaneFamily, installMaterializedTree } from '../scripts/materialize-cloud-data-plane-family.mjs';

const env = process.env, repoRoot = path.resolve('..');
const inputs = new Set([
  ...DATA_SUPPLY_DETECTION_CONFIG.lanes.flatMap(lane => lane.producer_members
    .flatMap(member => member.artifact_contracts.map(artifact => artifact.path))),
  ...LANE_REGISTRY.lanes.map(lane => lane.recovery_store).filter(Boolean),
  'data/admin/fenok-data-health-kpi.json',
  'data/admin/earnings_overview/refresh-summary.json',
  'data/admin/sentiment/source-observations/crypto.json',
  'data/computed/data-supply/etf-detail/index.json',
  'data/yf/_acquisition-state.json',
]);
// These readers enumerate members or follow paths in an index. Yahoo's state
// hydrator needs canonical payloads, not just acquisition observation metadata.
const memberRoots = ['data/earnings-overview/', 'data/briefing/',
  'data/stockanalysis/surfaces/', 'data/edgar-korean-summaries/by-ticker/',
  'data/admin/yahoo-hourly-ticker/keys/', 'data/yf/finance/'];
const patterns = [...inputs].filter(value => value.includes('*')).map(value =>
  new RegExp('^' + value.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$'));
const includeAsset = asset => {
  const name = asset.path.replace(/^public\//, '');
  return inputs.has(name) || memberRoots.some(prefix => name.startsWith(prefix))
    || patterns.some(pattern => pattern.test(name));
};
const families = [
  'platform-projections', 'slickcharts', 'fred-macro',
  'fred-banking', 'fred-yardeni', 'fdic-tier1', 'treasury-tga', 'defillama-stablecoins',
  'oecd-cli', 'sentiment', 'yahoo-ticker-macro', 'nasdaq-giw-sox', 'us-indices-daily',
  'krx-daily', 'edgar-korean-summaries', 'sec-13f', 'global-scouter', 'damodaran',
  'finra-short-volume', 'finra-ats-weekly', 'occ-options-availability',
  'yahoo-private-options', 'apewisdom-attention', 'gdelt-news-tone',
  'stockanalysis-etf-detail', 'stockanalysis-catalogue', 'earnings-overview',
  'briefing', 'yahoo-finance',
];
const base = await realpath(env.RUNNER_TEMP || env.TMPDIR || os.tmpdir());
const temporary = await mkdtemp(path.join(base, 'source-freshness-'));
try {
  for (const family of families) {
    const plane = createDefaultMaterializePlane({ family, accountId: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_API_TOKEN, endpoint: env.DATA_PLANE_ENDPOINT, writeKey: env.DATA_PLANE_WRITE_KEY });
    const receipt = await materializeCloudDataPlaneFamily({ plane, family, repoRoot, env,
      manifestPrefix: 'public/data', privateManifestPrefix: 'data', privacyClass: 'public',
      outputRoot: path.join(temporary, family), canonicalReuseRoot: repoRoot, includeAsset });
    await installMaterializedTree(receipt.output_root, path.join(repoRoot, 'data'), { env });
    console.log(`${family}: ${receipt.asset_count} active health inputs`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
JS
python3 ../scripts/yahoo_batch_state.py hydrate-generation \
  --state-root "$repo_root/data/admin/yahoo-batch-quote-history"

node --input-type=module -e 'import { emitDetectionExpectedFixture } from "../scripts/build-data-supply-detection-floor.mjs"; emitDetectionExpectedFixture();'

floor_output="$(mktemp -d /tmp/fenok-source-freshness-floor-XXXXXX)"
trap 'rm -rf "$floor_output"' EXIT
node ../scripts/build-data-supply-detection-floor.mjs \
  --artifact-root "$repo_root" \
  --calendars "$repo_root/scripts/lib/data-supply-detection-calendars.json" \
  --now "$(node -e 'process.stdout.write(new Date().toISOString())')" \
  --output-root "$floor_output"
node ../scripts/build-data-supply-detection-floor.mjs --verify-report "$floor_output/data-supply-detection-floor.json"
install -m 0644 "$floor_output/data-supply-detection-floor.json" "$repo_root/data/admin/data-supply-detection-floor.json"

npm run build:fenok-data-health-kpi
npm run qa:source-freshness-policy
npm run qa:fenok-data-health-kpi:artifact
