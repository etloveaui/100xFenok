#!/usr/bin/env bash
# Validate GitHub workflow syntax and expressions.

set -euo pipefail

actionlint_bin="${ACTIONLINT_BIN:-actionlint}"
# actionlint v1.7.12 predates GitHub's concurrency.queue support. Suppress only
# that release's exact queue-key diagnostic; expression diagnostics remain fatal.
queue_diagnostic='^unexpected key "queue" for "concurrency" section\. expected one of "cancel-in-progress", "group"$'
# Keep this gate on actionlint's native workflow checks. Optional host tools
# must not turn existing shell/Python style debt into environment-dependent CI.
actionlint_args=(
  -shellcheck ""
  -pyflakes ""
  -ignore "$queue_diagnostic"
)

"$actionlint_bin" "${actionlint_args[@]}"
echo "PASS repository workflows passed actionlint"
