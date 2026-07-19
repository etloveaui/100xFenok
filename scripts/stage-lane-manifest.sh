#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(pwd -P)"
MANIFEST=""
WORKFLOW=""
STAGE=""
EXPECTED_DIGEST=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root) REPO_ROOT=$(cd "$2" && pwd -P); shift 2 ;;
    --manifest) MANIFEST=$2; shift 2 ;;
    --workflow) WORKFLOW=$2; shift 2 ;;
    --stage) STAGE=$2; shift 2 ;;
    --expected-digest) EXPECTED_DIGEST=$2; shift 2 ;;
    -h|--help) echo 'stage-lane-manifest.sh --workflow <workflow> --stage <stage>'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

MANIFEST=${MANIFEST:-$REPO_ROOT/data/admin/lane-commit-manifest.json}
if [[ -z "$WORKFLOW" || -z "$STAGE" ]]; then echo "workflow and stage are required" >&2; exit 2; fi
case "$STAGE" in
  always_if_exists|success_if_exists|success_verify_not_plan_if_exists|required_on_success) ;;
  *) echo "lane-manifest stage is invalid" >&2; exit 2 ;;
esac
command -v jq >/dev/null 2>&1 || { echo "lane-manifest requires jq" >&2; exit 1; }
[[ -f "$MANIFEST" ]] || { echo "lane-manifest manifest is missing" >&2; exit 1; }

if [[ -z "$EXPECTED_DIGEST" ]]; then
  [[ -f "$REPO_ROOT/scripts/lib/lane-registry.mjs" ]] || { echo "cannot derive registry digest" >&2; exit 1; }
  EXPECTED_DIGEST=$(cd "$REPO_ROOT" && node --input-type=module -e 'import("./scripts/lib/lane-registry.mjs").then((m) => process.stdout.write(m.registryDigest()))')
fi
if [[ -f "$REPO_ROOT/scripts/build-lane-commit-manifest.mjs" ]]; then
  node "$REPO_ROOT/scripts/build-lane-commit-manifest.mjs" --check --output "$MANIFEST" >/dev/null
fi

jq -e --arg workflow "$WORKFLOW" --arg stage "$STAGE" --arg digest "$EXPECTED_DIGEST" '
  .schema_version == "lane-commit-manifest/v1"
  and .registry_schema == "lane-registry/v2"
  and .registry_digest == $digest
  and (.workflows | type == "object")
  and (.workflows[$workflow] | type == "object")
  and (.workflows[$workflow].stages[$stage] | type == "array")
  and (.workflows[$workflow].stages[$stage] | length > 0)
  and all(.workflows[$workflow].stages[$stage][];
    (.path | type == "string" and length > 0 and startswith("/") | not)
    and ((.path | split("/")) | index("..") | not)
    and (.path | test("[\u0000-\u001f\u007f]") | not)
    and (.kind == "file" or .kind == "directory" or .kind == "glob" or .kind == "dynamic_set")
    and (.required | type == "boolean")
  )
' "$MANIFEST" >/dev/null

cd "$REPO_ROOT"
declare -a SELECTED_EXACT=()
declare -a SELECTED_GLOB=()
declare -a SELECTED_DYNAMIC=()
declare -A SEEN=()

while IFS= read -r -d '' encoded; do
  spec=$(printf '%s' "$encoded" | base64 --decode)
  kind=$(jq -r '.kind' <<<"$spec")
  required=$(jq -r '.required' <<<"$spec")
  path_value=$(jq -r '.path' <<<"$spec")
  case "$kind" in
    file)
      [[ -f "$path_value" ]] || { [[ "$required" == "true" ]] && { echo "required file is missing" >&2; exit 1; } || continue; }
      [[ -z "${SEEN[$path_value]+x}" ]] && SELECTED_EXACT+=("$path_value") && SEEN[$path_value]=1
      ;;
    directory)
      [[ -d "$path_value" ]] || { [[ "$required" == "true" ]] && { echo "required directory is missing" >&2; exit 1; } || continue; }
      [[ -z "${SEEN[$path_value]+x}" ]] && SELECTED_EXACT+=("$path_value") && SEEN[$path_value]=1
      ;;
    glob)
      mapfile -t matches < <(compgen -G "$path_value" || true)
      if [[ ${#matches[@]} -eq 0 ]]; then [[ "$required" == "true" ]] && { echo "required glob has no matches" >&2; exit 1; } || continue; fi
      for match in "${matches[@]}"; do [[ -z "${SEEN[$match]+x}" ]] && SELECTED_GLOB+=("$match") && SEEN[$match]=1; done
      ;;
    dynamic_set)
      mapfile -d '' -t matches < <(git ls-files --modified --others --exclude-standard -z -- "$path_value")
      if [[ ${#matches[@]} -eq 0 && "$required" == "true" ]]; then echo "required dynamic set is empty" >&2; exit 1; fi
      for match in "${matches[@]}"; do [[ -z "${SEEN[$match]+x}" ]] && SELECTED_DYNAMIC+=("$match") && SEEN[$match]=1; done
      ;;
  esac
done < <(jq -j --arg workflow "$WORKFLOW" --arg stage "$STAGE" '.workflows[$workflow].stages[$stage][] | @base64 + "\u0000"' "$MANIFEST")

for path_value in "${SELECTED_EXACT[@]}" "${SELECTED_GLOB[@]}"; do git add -- "$path_value"; done
if [[ ${#SELECTED_DYNAMIC[@]} -gt 0 ]]; then printf '%s\0' "${SELECTED_DYNAMIC[@]}" | git add --pathspec-from-file=- --pathspec-file-nul; fi

while IFS= read -r -d '' encoded; do
  spec=$(printf '%s' "$encoded" | base64 --decode)
  exclude_path=$(jq -r '.path' <<<"$spec")
  if git cat-file -e "HEAD:$exclude_path" 2>/dev/null; then
    git restore --staged -- "$exclude_path"
  else
    git rm -r --cached --ignore-unmatch -- "$exclude_path" >/dev/null
  fi
done < <(jq -j --arg workflow "$WORKFLOW" '.workflows[$workflow].exclude[]? | @base64 + "\u0000"' "$MANIFEST")

declared_count=$(jq -r --arg workflow "$WORKFLOW" --arg stage "$STAGE" '.workflows[$workflow].stages[$stage] | length' "$MANIFEST")
stage_selected=$(( ${#SELECTED_EXACT[@]} + ${#SELECTED_GLOB[@]} + ${#SELECTED_DYNAMIC[@]} ))
staged_index_total=$(git diff --cached --name-only | awk 'NF { count += 1 } END { print count + 0 }')
digest_prefix=${EXPECTED_DIGEST:0:12}
printf 'lane-manifest stage proof: digest=%s workflow=%s stage=%s declared=%s stage_selected=%s staged_index_total=%s\n' "$digest_prefix" "$WORKFLOW" "$STAGE" "$declared_count" "$stage_selected" "$staged_index_total"
