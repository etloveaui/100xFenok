#!/usr/bin/env python3
"""Static route contract for bounded scheduled StockAnalysis stock acquisition."""

from __future__ import annotations

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "fetch-stockanalysis.yml"
STOCK_CRON = "20 21 * * *"


class StockAnalysisWorkflowContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = WORKFLOW.read_text(encoding="utf-8")

    def test_dedicated_stock_schedule_is_fixed_bounded_and_pair_required(self) -> None:
        self.assertIn(f"- cron: '{STOCK_CRON}'", self.text)
        branch = re.search(
            rf'if \[ "\$EVENT_SCHEDULE" = "{re.escape(STOCK_CRON)}" \]; then(?P<body>.*?)\n\s*(?:elif|else) ',
            self.text,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(branch)
        body = branch.group("body")
        focus = re.search(r'INPUT_STOCKS="([A-Z0-9.,-]+)"', body)
        self.assertIsNotNone(focus)
        tickers = [item for item in focus.group(1).split(",") if item]
        self.assertGreater(len(tickers), 0)
        self.assertLessEqual(len(tickers), 8)
        self.assertEqual(len(tickers), len(set(tickers)))
        for expected in (
            'INPUT_STOCKS_ONLY="true"',
            'INPUT_FETCH_FINANCIALS="true"',
            'INPUT_INCREMENTAL_ETF_BACKFILL="false"',
            'INPUT_FETCH_SURFACES="false"',
            'INPUT_DISCOVER_UNIVERSE="false"',
            'NATURAL_RECOVERY_KINDS="stock,financial"',
            'INPUT_STOCK_LIMIT="8"',
            'INPUT_REQUIRE_STOCK_FINANCIAL_PAIR="true"',
            'INPUT_ISOLATED_STOCK_SCHEDULE="true"',
        ):
            self.assertIn(expected, body)
        self.assertIn(
            'if [ "${INPUT_ISOLATED_STOCK_SCHEDULE:-false}" = "true" ]; then',
            self.text,
        )
        self.assertIn("scripts/stockanalysis_artifact.py", self.text)
        self.assertIn("scripts/stage-lane-manifest.sh", self.text)

    def test_each_known_schedule_has_an_exact_recovery_scope_and_unknown_fails_closed(self) -> None:
        for schedule, scope in (
            ("20 21 * * *", "stock,financial"),
            ("50 22 * * 1-5", "none"),
            ("50 23 * * 1-5", "surface"),
            ("20 23 * * 0", "surface,universe"),
        ):
            self.assertIsNotNone(
                re.search(
                    rf'\$EVENT_SCHEDULE" = "{re.escape(schedule)}".*?NATURAL_RECOVERY_KINDS="{re.escape(scope)}"',
                    self.text,
                    flags=re.DOTALL,
                ),
                f"schedule {schedule} must select recovery scope {scope}",
            )
        self.assertIn('echo "unknown StockAnalysis schedule: $EVENT_SCHEDULE" >&2', self.text)
        self.assertIn("exit 64", self.text)
        self.assertIn('--natural-recovery-kinds $NATURAL_RECOVERY_KINDS', self.text)

    def test_history_gap_dispatch_forwards_explicit_ticker_shards(self) -> None:
        branch = re.search(
            r'elif \[ "\$\{INPUT_HISTORY_GAPS_ONLY:-false\}" = "true" \]; then(?P<body>.*?)\n\s*else',
            self.text,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(branch)
        self.assertIn(
            'if [ -n "$INPUT_ETFS" ]; then ARGS="$ARGS --etfs $INPUT_ETFS"; fi',
            branch.group("body"),
        )

    def test_only_daily_1y_profile_requests_canonical_plan_write(self) -> None:
        self.assertNotIn("--history-gaps-only --plan-only --write-plan", self.text)
        self.assertIn(
            'if [ "$INPUT_REQUIRED_HISTORY_PERIODS" = "daily_1y" ]; then ARGS="$ARGS --write-plan"; fi',
            self.text,
        )
        self.assertIn(
            'if [ "$REQUIRED_HISTORY_PERIODS" = "daily_1y" ]; then ARGS="$ARGS --write-plan"; fi',
            self.text,
        )

    def test_bare_dispatch_defaults_to_canonical_daily_1y_profile(self) -> None:
        required_periods_input = re.search(
            r"required_history_periods:\n(?P<body>(?:\s+.*\n){1,5})",
            self.text,
        )
        self.assertIsNotNone(required_periods_input)
        self.assertIn("default: 'daily_1y'", required_periods_input.group("body"))

    def test_manifest_staging_keeps_dynamic_yf_selection_before_exclusions(self) -> None:
        commit_step = re.search(
            r"- name: Publish candidate to latest main\n(?P<header>.*?)\n\s+run: \|\n(?P<body>.*?)(?=\n\s+- name:)",
            self.text,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(commit_step)
        self.assertIn("id: publish", commit_step.group("header"))
        body = commit_step.group("body")
        manifest_call = "scripts/stage-lane-manifest.sh"
        audit = "python3 scripts/stockanalysis_artifact.py audit-stage"
        for expected in (manifest_call, "--stage always_if_exists", audit):
            self.assertIn(expected, body)
        self.assertLess(body.index(manifest_call), body.index(audit))
        self.assertNotIn("git add -A", body)

    def test_acquire_is_read_only_and_publish_alone_owns_global_writer(self) -> None:
        self.assertNotRegex(self.text, r"(?m)^concurrency:\n")
        acquire = re.search(
            r"  acquire-stockanalysis:\n(?P<body>.*?)(?=\n  publish-stockanalysis:)",
            self.text,
            flags=re.DOTALL,
        )
        publish = re.search(
            r"  publish-stockanalysis:\n(?P<body>.*)\Z",
            self.text,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(acquire)
        self.assertIsNotNone(publish)
        acquire_body = acquire.group("body")
        publish_body = publish.group("body")
        self.assertIn("permissions:\n      contents: read\n      actions: read", acquire_body)
        self.assertIn("group: stockanalysis-acquire-${{ github.ref }}", acquire_body)
        self.assertIn("PYTHONDONTWRITEBYTECODE: '1'", acquire_body)
        self.assertIn("Assert acquisition checkout stayed byte-clean", acquire_body)
        self.assertIn("git diff --cached --exit-code", acquire_body)
        self.assertIn("--untracked-files=all --ignored", acquire_body)
        self.assertNotIn("fenok-data-writer-refs/heads/main", acquire_body)
        for forbidden in ("git commit", "git push", "gh workflow run", "100xfenok-next/public"):
            self.assertNotIn(forbidden, acquire_body)
        self.assertIn("permissions:\n      contents: write\n      actions: write", publish_body)
        self.assertIn("timeout-minutes: 20", publish_body)
        self.assertIn("group: fenok-data-writer-refs/heads/main", publish_body)
        self.assertIn("cancel-in-progress: false", publish_body)
        self.assertIn("queue: max", publish_body)

    def test_candidate_artifact_is_context_bound_and_immutable(self) -> None:
        for expected in (
            "--candidate-root \"$STOCKANALYSIS_CANDIDATE_ROOT\"",
            "--no-public-mirror",
            "actions/upload-artifact@v4",
            "actions/download-artifact@v4",
            "stockanalysis-${{ github.run_id }}-${{ github.run_attempt }}",
            "artifact-digest",
            "github.run_number",
            "scripts/stockanalysis_artifact.py pack",
            "scripts/stockanalysis_artifact.py apply",
        ):
            self.assertIn(expected, self.text)
        self.assertNotIn("overwrite: true", self.text)

    def test_manual_network_etf_cap_is_forwarded_without_changing_natural_profiles(self) -> None:
        incremental_input = re.search(
            r"incremental_etf_limit:\n(?P<body>(?:\s+.*\n){1,5})",
            self.text,
        )
        reconcile_input = re.search(
            r"reconcile_missing_etf_limit:\n(?P<body>(?:\s+.*\n){1,5})",
            self.text,
        )
        limit_input = re.search(
            r"limit_etfs:\n(?P<body>(?:\s+.*\n){1,5})",
            self.text,
        )
        self.assertIn("default: '0'", incremental_input.group("body"))
        self.assertIn("default: '100'", limit_input.group("body"))
        self.assertIn("default: '100'", reconcile_input.group("body"))
        self.assertIn('--event-name "$EVENT_NAME"', self.text)
        self.assertIn('INPUT_INCREMENTAL_ETF_LIMIT="${STOCKANALYSIS_DAILY1Y_INCREMENTAL_LIMIT:-120}"', self.text)
        self.assertIn('INPUT_INCREMENTAL_ETF_LIMIT="${STOCKANALYSIS_DAILY_INCREMENTAL_LIMIT:-40}"', self.text)

    def test_manual_preflight_precedes_candidate_seed_and_provider_fetch(self) -> None:
        preflight = self.text.index("--preflight-only")
        seed = self.text.index("scripts/stockanalysis_artifact.py seed")
        candidate_fetch = self.text.index(
            '--candidate-root "$STOCKANALYSIS_CANDIDATE_ROOT"',
            seed,
        )
        self.assertLess(preflight, seed)
        self.assertLess(seed, candidate_fetch)

    def test_publish_restarts_from_fresh_main_and_never_rebases_candidate(self) -> None:
        publish = self.text.split("  publish-stockanalysis:\n", 1)[1]
        self.assertIn("git checkout -f -B main origin/main", publish)
        self.assertIn("for attempt in $(seq 1 5)", publish)
        self.assertNotIn("git rebase", publish)
        self.assertNotIn("git pull --rebase", publish)
        self.assertIn("StockAnalysis-Artifact-Digest:", publish)
        self.assertIn("COMMIT_ARGS=(--allow-empty)", publish)
        self.assertIn('ACCEPTED_STATUS="accepted_no_changes"', publish)
        self.assertNotIn('echo "status=no_changes"', publish)
        self.assertLess(publish.index("git checkout -f -B main origin/main"), publish.index("git commit \"${COMMIT_ARGS[@]}\""))
        self.assertLess(publish.index("git commit \"${COMMIT_ARGS[@]}\""), publish.index("git push origin HEAD:main"))
        self.assertIn("if: ${{ steps.publish.outputs.status == 'published' }}", publish)

    def test_projection_oracle_preserves_surface_relative_root(self) -> None:
        publish = self.text.split("  publish-stockanalysis:\n", 1)[1]
        self.assertIn(
            'PROJECTION_ORACLE_ROOT="$RUNNER_TEMP/stockanalysis-projection-oracle"',
            publish,
        )
        self.assertIn('PROJECTION_ORACLE="$PROJECTION_ORACLE_ROOT/surfaces"', publish)
        self.assertIn('rm -rf "$PROJECTION_ORACLE_ROOT"', publish)
        self.assertIn('mkdir -p "$PROJECTION_ORACLE"', publish)
        self.assertIn(
            'rsync -a --checksum --delete data/stockanalysis/surfaces/ "$PROJECTION_ORACLE/"',
            publish,
        )
        self.assertIn(
            'STOCKANALYSIS_PROJECTION_ORACLE_DIR="$PROJECTION_ORACLE"',
            publish,
        )
        self.assertLess(
            publish.index('rm -rf "$PROJECTION_ORACLE_ROOT"'),
            publish.index('mkdir -p "$PROJECTION_ORACLE"'),
        )
        self.assertLess(
            publish.index('mkdir -p "$PROJECTION_ORACLE"'),
            publish.index('rsync -a --checksum --delete data/stockanalysis/surfaces/'),
        )


if __name__ == "__main__":
    unittest.main()
