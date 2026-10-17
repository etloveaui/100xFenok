#!/usr/bin/env bash
# Decide whether this disposable candidate may replace the active generation.
set -euo pipefail
[[ $# -eq 2 ]] || { echo "usage: $0 <member> <row-json>" >&2; exit 2; }
member=$1
row_path=$2
[[ -f "$row_path" ]] || { echo "saved SlickCharts row is missing" >&2; exit 2; }
[[ -n "${SLICKCHARTS_COMPOSITE_STATUS_PATH:-}" ]] || exit 2
composite_index=data/admin/slickcharts-composite-recovery/index.json
meta=$(node -e '
  const fs=require("fs"), s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  if (s.schema_version!=="slickcharts-composite-run-status/v1" || s.lane_id!=="slickcharts"
    || s.member!==process.argv[2] || ![0,2].includes(s.exit_code)
    || typeof s.publish_data!=="boolean") process.exit(2);
  process.stdout.write(`${s.exit_code} ${s.publish_data}`);
' "$SLICKCHARTS_COMPOSITE_STATUS_PATH" "$member")
read -r recovery_exit publish_data <<< "$meta"
node scripts/slickcharts-composite-recovery.mjs validate --index "$composite_index" >/dev/null
node scripts/slickcharts-composite-recovery.mjs validate-live --repo-root "$PWD" --index "$composite_index" >/dev/null
if [[ "$member" == daily ]]; then
  daily_meta=$(node -e '
    const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    if (![0,2].includes(s.exit_code) || typeof s.publish_data!=="boolean") process.exit(2);
    process.stdout.write(`${s.exit_code} ${s.publish_data}`);
  ' "$SLICKCHARTS_RECOVERY_STATUS_PATH")
  read -r daily_exit daily_publish <<< "$daily_meta"
  if [[ "$daily_exit" != 0 ]]; then recovery_exit=$daily_exit; fi
  if [[ "$daily_publish" != true ]]; then publish_data=false; fi
fi
if [[ "$publish_data" != true ]]; then exit 2; fi
exit "$recovery_exit"
