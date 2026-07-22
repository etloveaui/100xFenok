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
declare -a SELECTED_TRACKED_FILES=()
declare -a SELECTED_UNTRACKED_FILES=()
declare -a SELECTED_DIRECTORIES=()
declare -a SELECTED_DIRECTORY_TRACKED=()
declare -a SELECTED_DIRECTORY_UNTRACKED=()
declare -a SELECTED_GLOB=()
declare -a SELECTED_DYNAMIC=()
declare -A SEEN=()

is_git_ignored() {
  git check-ignore -q -- "$1"
}

handle_ignored_manifest_path() {
  local kind=$1
  local path_value=$2
  local required=$3
  if [[ "$required" == "true" ]]; then
    echo "lane-manifest conflict: manifest declares '$path_value' required while .gitignore excludes it ($kind)" >&2
    return 1 # required-ignore-conflict
  fi
  echo "lane-manifest skip ignored optional $kind path: $path_value (.gitignore excludes it)" >&2
  return 0
}

select_directory_path() {
  local path_value=$1
  if [[ -n "${SEEN[$path_value]+x}" ]]; then return 0; fi
  SELECTED_DIRECTORIES+=("$path_value")
  SEEN[$path_value]=1
  mapfile -d '' -t matches < <(git ls-files --modified -z -- "$path_value")
  SELECTED_DIRECTORY_TRACKED+=("${matches[@]}")
  mapfile -d '' -t matches < <(git ls-files --others --exclude-standard -z -- "$path_value")
  SELECTED_DIRECTORY_UNTRACKED+=("${matches[@]}")
}

select_file_path() {
  local selection_kind=$1
  local path_value=$2
  if [[ -n "${SEEN[$path_value]+x}" ]]; then return 0; fi
  if [[ "$selection_kind" == "file" ]]; then SELECTED_EXACT+=("$path_value"); else SELECTED_GLOB+=("$path_value"); fi
  SEEN[$path_value]=1
  if git ls-files --error-unmatch -- "$path_value" >/dev/null 2>&1; then
    SELECTED_TRACKED_FILES+=("$path_value")
  else
    SELECTED_UNTRACKED_FILES+=("$path_value")
  fi
}

while IFS= read -r -d '' encoded; do
  spec=$(printf '%s' "$encoded" | base64 --decode)
  kind=$(jq -r '.kind' <<<"$spec")
  required=$(jq -r '.required' <<<"$spec")
  path_value=$(jq -r '.path' <<<"$spec")
  case "$kind" in
    file)
      [[ -f "$path_value" ]] || { [[ "$required" == "true" ]] && { echo "required file is missing" >&2; exit 1; } || continue; }
      if is_git_ignored "$path_value"; then
        if ! handle_ignored_manifest_path "$kind" "$path_value" "$required"; then exit 1; fi
        continue
      fi
      select_file_path "$kind" "$path_value"
      ;;
    directory)
      [[ -d "$path_value" ]] || { [[ "$required" == "true" ]] && { echo "required directory is missing" >&2; exit 1; } || continue; }
      if is_git_ignored "$path_value"; then
        if ! handle_ignored_manifest_path "$kind" "$path_value" "$required"; then exit 1; fi
        continue
      fi
      select_directory_path "$path_value"
      ;;
    glob)
      mapfile -t matches < <(compgen -G "$path_value" || true)
      if [[ ${#matches[@]} -eq 0 ]]; then [[ "$required" == "true" ]] && { echo "required glob has no matches" >&2; exit 1; } || continue; fi
      for match in "${matches[@]}"; do
        if is_git_ignored "$match"; then
          if ! handle_ignored_manifest_path "$kind" "$match" "$required"; then exit 1; fi
          continue
        fi
        if [[ -d "$match" ]]; then
          select_directory_path "$match"
        else
          select_file_path "$kind" "$match"
        fi
      done
      ;;
    dynamic_set)
      mapfile -d '' -t matches < <(git ls-files --modified --others --exclude-standard -z -- "$path_value")
      if [[ ${#matches[@]} -eq 0 && "$required" == "true" ]]; then echo "required dynamic set is empty" >&2; exit 1; fi
      for match in "${matches[@]}"; do [[ -z "${SEEN[$match]+x}" ]] && SELECTED_DYNAMIC+=("$match") && SEEN[$match]=1; done
      ;;
  esac
done < <(jq -j --arg workflow "$WORKFLOW" --arg stage "$STAGE" '.workflows[$workflow].stages[$stage][] | @base64 + "\u0000"' "$MANIFEST")

if [[ ${#SELECTED_TRACKED_FILES[@]} -gt 0 ]]; then printf '%s\0' "${SELECTED_TRACKED_FILES[@]}" | git add -u --pathspec-from-file=- --pathspec-file-nul; fi
if [[ ${#SELECTED_UNTRACKED_FILES[@]} -gt 0 ]]; then printf '%s\0' "${SELECTED_UNTRACKED_FILES[@]}" | git add --pathspec-from-file=- --pathspec-file-nul; fi
if [[ ${#SELECTED_DIRECTORY_TRACKED[@]} -gt 0 ]]; then printf '%s\0' "${SELECTED_DIRECTORY_TRACKED[@]}" | git add -u --pathspec-from-file=- --pathspec-file-nul; fi
if [[ ${#SELECTED_DIRECTORY_UNTRACKED[@]} -gt 0 ]]; then printf '%s\0' "${SELECTED_DIRECTORY_UNTRACKED[@]}" | git add --pathspec-from-file=- --pathspec-file-nul; fi
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
stage_selected=$(( ${#SELECTED_EXACT[@]} + ${#SELECTED_DIRECTORIES[@]} + ${#SELECTED_GLOB[@]} + ${#SELECTED_DYNAMIC[@]} ))
staged_index_total=$(git diff --cached --name-only | awk 'NF { count += 1 } END { print count + 0 }')
digest_prefix=${EXPECTED_DIGEST:0:12}
printf 'lane-manifest stage proof: digest=%s workflow=%s stage=%s declared=%s stage_selected=%s staged_index_total=%s\n' "$digest_prefix" "$WORKFLOW" "$STAGE" "$declared_count" "$stage_selected" "$staged_index_total"
