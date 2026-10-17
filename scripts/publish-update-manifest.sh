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
  cp -R "$output/." data/
done
for family in apewisdom-attention finra-short-volume; do
  node scripts/materialize-cloud-data-plane-family.mjs --hydrate-private-family "$family"
done
stockanalysis_basis="$(node scripts/materialize-cloud-data-plane-family.mjs --hydrate-stockanalysis)"
node scripts/materialize-update-manifest-routes.mjs --all --validate-only
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
