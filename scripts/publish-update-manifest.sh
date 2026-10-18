#!/usr/bin/env bash
# Runs in the disposable Update Manifest Actions checkout.
set -euo pipefail
mkdir -p 100xfenok-next/public/data
# Restore the active derived state before rebuilding so KPI history, metadata
# and membership deltas start from the promoted generation.
for family in platform-projections slickcharts damodaran yahoo-ticker-macro earnings-overview edgar-korean-summaries krx-daily yahoo-private-options; do
  output="$RUNNER_TEMP/update-manifest-$family"
  node scripts/materialize-cloud-data-plane-family.mjs --family "$family" \
    --privacy-class public --manifest-prefix public/data --private-manifest-prefix data \
    --output-root "$output" > "$RUNNER_TEMP/update-manifest-$family.json"
  mkdir -p data
  node scripts/materialize-cloud-data-plane-family.mjs --install-tree "$output" data
done
for family in apewisdom-attention finra-short-volume; do
  node scripts/materialize-cloud-data-plane-family.mjs --hydrate-private-family "$family"
done
# The KPI/detection floor reads these producer clocks and recovery indexes.
# Only their exact inputs are needed; raw histories stay in the active plane.
node --input-type=module <<'JS'
import path from 'node:path';
import { createDefaultMaterializePlane, materializeCloudDataPlaneFamily, installMaterializedTree } from './scripts/materialize-cloud-data-plane-family.mjs';
const env = process.env, repoRoot = process.cwd();
for (const [family, privacyClass, files] of [
  ['finra-ats-weekly', 'private', ['data/admin/finra-ats/current/weekly-summary.json', 'data/admin/finra-ats/index.json']],
  ['fred-yardeni', 'public', ['public/data/yardney/yardney_model.json', 'data/admin/fred_yardeni/index.json']],
  ['oecd-cli', 'private', ['data/admin/oecd_cli/shadow/oecd-cli.json', 'data/admin/oecd_cli/index.json']],
  ['sentiment', 'public', ['data/admin/sentiment/index.json']],
]) {
  const wanted = new Set(files);
  const plane = createDefaultMaterializePlane({ family, accountId: env.CLOUDFLARE_ACCOUNT_ID,
    token: env.CLOUDFLARE_API_TOKEN, endpoint: env.DATA_PLANE_ENDPOINT, writeKey: env.DATA_PLANE_WRITE_KEY });
  const receipt = await materializeCloudDataPlaneFamily({ plane, family, repoRoot, env,
    privacyClass, manifestPrefix: privacyClass === 'public' ? 'public/data' : 'data',
    privateManifestPrefix: privacyClass === 'public' ? 'data' : null,
    outputRoot: path.join(env.RUNNER_TEMP, `update-manifest-health-${family}`),
    canonicalReuseRoot: repoRoot, includeAsset: asset => wanted.has(asset.path) });
  await installMaterializedTree(receipt.output_root, path.join(repoRoot, 'data'), { env });
}
JS
stockanalysis_basis="$(node scripts/materialize-cloud-data-plane-family.mjs --hydrate-stockanalysis)"
# The projection runner hydrates the remaining macro/index families before
# its S3 materialization validates every required source.
bash scripts/update-manifest-projections.sh
# Retain the existing source-generation fence without restoring a Git LKG tree.
node --input-type=module - "$stockanalysis_basis" <<'JS'
import {createDefaultMaterializePlane, readActiveFamilyIdentity} from './scripts/materialize-cloud-data-plane-family.mjs';
const basis=JSON.parse(process.argv[2]), e=process.env;
for (const [key,family] of [['etf','stockanalysis-etf-detail'],['catalogue','stockanalysis-catalogue']]) {
  const plane=createDefaultMaterializePlane({family,accountId:e.CLOUDFLARE_ACCOUNT_ID,token:e.CLOUDFLARE_API_TOKEN,endpoint:e.DATA_PLANE_ENDPOINT,writeKey:e.DATA_PLANE_WRITE_KEY});
  const {identity}=await readActiveFamilyIdentity({plane,family});
  if (identity.generation_id!==basis[key]) throw new Error(`Projection source generation changed: ${family}`);
}
JS
basis="$RUNNER_TEMP/update-manifest-platform-projections.json"
export PUBLISH_EXPECTED_ACTIVE_GENERATION_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["generation_id"])' "$basis")"
export PUBLISH_EXPECTED_ACTIVE_MANIFEST_SHA256="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["manifest_sha256"])' "$basis")"
node scripts/publish-cloud-data-generation.mjs --family=platform-projections --json
