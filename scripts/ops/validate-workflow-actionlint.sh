#!/usr/bin/env bash
# Validate GitHub workflow semantics and guard the runner-context regression.

set -euo pipefail

actionlint_bin="${ACTIONLINT_BIN:-actionlint}"
fixture_dir="scripts/ops/fixtures/workflow-actionlint"
invalid_fixture="$fixture_dir/invalid-job-runner-temp.yml"
control_fixture="$fixture_dir/valid-step-runner-temp.yml"

# actionlint v1.7.12 predates GitHub's concurrency.queue support. Suppress only
# that release's exact queue-key diagnostic; expression diagnostics remain fatal.
queue_diagnostic='^unexpected key "queue" for "concurrency" section\. expected one of "cancel-in-progress", "group"$'

set +e
invalid_output="$("$actionlint_bin" -ignore "$queue_diagnostic" "$invalid_fixture" 2>&1)"
invalid_status=$?
set -e

if [[ $invalid_status -eq 0 ]]; then
  echo "FAIL regression fixture unexpectedly passed: $invalid_fixture" >&2
  exit 1
fi

if ! grep -Fq 'context "runner" is not allowed here' <<<"$invalid_output"; then
  echo "FAIL regression fixture did not report the runner-context violation:" >&2
  echo "$invalid_output" >&2
  exit 1
fi
echo "PASS regression fixture rejected job-level runner.temp"

if ! "$actionlint_bin" -ignore "$queue_diagnostic" "$control_fixture"; then
  echo "FAIL control fixture was rejected: $control_fixture" >&2
  exit 1
fi
echo "PASS control fixture accepted step-level RUNNER_TEMP via GITHUB_ENV"

"$actionlint_bin" -ignore "$queue_diagnostic"
echo "PASS repository workflows passed actionlint"
