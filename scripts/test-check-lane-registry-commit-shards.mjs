#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkWorkflowCommitShardsAgainstRegistry,
  extractManifestStageInvocations,
  extractManifestWrapperBindings,
} from "./check-lane-registry-commit-shards.mjs";
import { LANE_REGISTRY } from "./lib/lane-registry.mjs";

const WORKFLOW = ".github/workflows/fetch-fred-macro.yml";
const PUBLISH_OUTCOME = "data/admin/data-supply-state/publish-outcomes/fred-macro.json";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEEKLY = ".github/workflows/slickcharts-weekly.yml";

function gate(workflowText) {
  return checkWorkflowCommitShardsAgainstRegistry({
    workflowText,
    workflowRel: WORKFLOW,
  });
}

function weeklyGate(workflowText) {
  return checkWorkflowCommitShardsAgainstRegistry({
    workflowText,
    workflowRel: WEEKLY,
    repoRoot: REPO_ROOT,
  });
}

const exactInvocation = String.raw`
scripts/stage-lane-manifest.sh \
  --workflow .github/workflows/fetch-fred-macro.yml \
  --stage always_if_exists
`;

// An exact helper invocation proves the registry policy stage, including the
// publish-outcome shard that is not repeated as a workflow literal.
{
  assert.deepEqual(extractManifestStageInvocations(exactInvocation), [
    { workflow: WORKFLOW, stage: "always_if_exists" },
  ]);
  const result = gate(exactInvocation);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.missing_in_workflow.some(({ shard }) => shard === PUBLISH_OUTCOME), false);
}

// A helper call for another workflow must not borrow that workflow's policy.
{
  const result = gate(exactInvocation.replace(WORKFLOW, ".github/workflows/fetch-fred-banking.yml"));
  assert.equal(result.ok, false);
  assert.ok(result.missing_in_workflow.some(({ shard }) => shard === PUBLISH_OUTCOME));
}

// A missing or unknown stage is not evidence of staging coverage.
for (const stage of ["success_if_exists", "not_a_manifest_stage"]) {
  const result = gate(exactInvocation.replace("always_if_exists", stage));
  assert.equal(result.ok, false, `stage ${stage} must fail closed`);
  assert.ok(result.missing_in_workflow.some(({ shard }) => shard === PUBLISH_OUTCOME));
}

// A valid invocation cannot compensate for a missing registry policy.
{
  const registryWithoutPolicy = structuredClone(LANE_REGISTRY);
  delete registryWithoutPolicy.workflow_policies[WORKFLOW];
  const result = checkWorkflowCommitShardsAgainstRegistry({
    workflowText: exactInvocation,
    workflowRel: WORKFLOW,
    registry: registryWithoutPolicy,
  });
  assert.equal(result.ok, false);
  assert.ok(result.missing_in_workflow.some(({ shard }) => shard === PUBLISH_OUTCOME));
}

// A malformed command is ignored rather than becoming a false-green proof.
{
  const malformed = "scripts/stage-lane-manifest.sh --workflow .github/workflows/fetch-fred-macro.yml";
  assert.deepEqual(extractManifestStageInvocations(malformed), []);
  const result = gate(malformed);
  assert.equal(result.ok, false);
  assert.ok(result.missing_in_workflow.some(({ shard }) => shard === PUBLISH_OUTCOME));
}

// Existing literal paths remain a complete and independent allowlist.
{
  const legacyPaths = [
    "data/admin/data-supply-state/detection-attempts/fred_macro.json",
    PUBLISH_OUTCOME,
    "data/admin/fred_macro/index.json",
    "data/admin/fred_macro/lkg/fred_macro.json",
  ].join("\n");
  const result = gate(legacyPaths);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(extractManifestStageInvocations(legacyPaths), []);
}

// Mentioning the helper in a comment is not an invocation.
{
  const mentionOnly = "# scripts/stage-lane-manifest.sh --workflow .github/workflows/fetch-fred-macro.yml --stage always_if_exists";
  assert.deepEqual(extractManifestStageInvocations(mentionOnly), []);
  const result = gate(mentionOnly);
  assert.equal(result.ok, false);
  assert.ok(result.missing_in_workflow.some(({ shard }) => shard === PUBLISH_OUTCOME));
}

// A non-comment shell control operator after an otherwise valid invocation
// must reject the whole command, never truncate it into a proof.
{
  for (const operator of ["&&", "||", "|", ";", "&"]) {
    const dangling = `${exactInvocation.trim()} ${operator}`;
    assert.deepEqual(
      extractManifestStageInvocations(dangling),
      [],
      `dangling ${operator} must not be truncated into an invocation`,
    );
    const result = gate(dangling);
    assert.equal(result.ok, false, `dangling ${operator} must fail closed`);
    assert.ok(result.missing_in_workflow.some(({ shard }) => shard === PUBLISH_OUTCOME));
  }
}

// A chained command after the helper is not a valid invocation either.
{
  const chained = `${exactInvocation.trim()} && git add data/admin/data-supply-state/detection-attempts/fred_macro.json`;
  assert.deepEqual(extractManifestStageInvocations(chained), []);
  const result = gate(chained);
  assert.equal(result.ok, false);
  assert.ok(result.missing_in_workflow.some(({ shard }) => shard === PUBLISH_OUTCOME));
}

// A terminal shell comment is a real boundary: the command ends there and the
// rest of the line is ignored, with or without a space after the `#`.
{
  for (const commented of [
    `${exactInvocation.trim()} # trailing comment`,
    `${exactInvocation.trim()} #`,
    `${exactInvocation.trim()} #comment-without-space`,
  ]) {
    assert.deepEqual(
      extractManifestStageInvocations(commented),
      [{ workflow: WORKFLOW, stage: "always_if_exists" }],
      `comment boundary must keep the invocation: ${commented}`,
    );
  }
  const result = gate(`${exactInvocation.trim()} # still staged`);
  assert.equal(result.ok, true, JSON.stringify(result));
}

// A comment does not rescue an operator that precedes it.
{
  const operatorBeforeComment = `${exactInvocation.trim()} && # comment`;
  assert.deepEqual(extractManifestStageInvocations(operatorBeforeComment), []);
}

// A comment inside the option stream ends the command before it is complete.
{
  const incomplete = "scripts/stage-lane-manifest.sh --workflow .github/workflows/fetch-fred-macro.yml # --stage always_if_exists";
  assert.deepEqual(extractManifestStageInvocations(incomplete), []);
}

// Wrapper: only the real publish-slickcharts-attempt.sh grammar proves a
// manifest binding — <member> <row-json> <commit-message> followed by the
// exact sequence --manifest-workflow <workflow> --manifest-always <stage>
// [--manifest-data <stage>] -- with data paths only after the sentinel.
{
  const valid = String.raw`
scripts/publish-slickcharts-attempt.sh \
  weekly \
  "$RUNNER_TEMP/slickcharts-weekly-row.json" \
  "chore: update SlickCharts weekly data $(date -u +%Y-%m-%d)" \
  --manifest-workflow .github/workflows/slickcharts-weekly.yml \
  --manifest-always always_if_exists \
  --manifest-data success_if_exists \
  -- \
  data/slickcharts/sp500.json
`;
  assert.deepEqual(extractManifestWrapperBindings(valid), [
    {
      workflow: ".github/workflows/slickcharts-weekly.yml",
      always: "always_if_exists",
      data: "success_if_exists",
    },
  ]);
}

// Wrapper: every deviation from the grammar is rejected, including reordered
// or duplicate/unknown flags, a missing sentinel, options after the sentinel,
// missing positionals, a member that does not match the workflow, and any
// control operator or data path inside the option stream.
{
  const malformedWrappers = [
    ["reordered flags", `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-always always_if_exists --manifest-workflow .github/workflows/slickcharts-weekly.yml --`],
    ["missing sentinel", `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists`],
    ["option after sentinel", `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists -- --manifest-data success_if_exists`],
    ["duplicate option", `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists --manifest-workflow .github/workflows/slickcharts-weekly.yml --`],
    ["unknown option", `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists --manifest-extra value --`],
    ["missing positionals", `scripts/publish-slickcharts-attempt.sh --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists --`],
    ["member does not match workflow", `scripts/publish-slickcharts-attempt.sh daily "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists --`],
    ["workflow does not match member", `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-daily.yml --manifest-always always_if_exists --`],
    ["bare invocation", `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg"`],
    ["dangling operator", `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists -- && echo hi`],
    ["data path inside option stream", `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" data/slickcharts/sp500.json --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists --`],
    ["unknown stage", `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always not_a_stage --`],
    ["malformed member id", `scripts/publish-slickcharts-attempt.sh "we ird" "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists --`],
  ];
  for (const [label, text] of malformedWrappers) {
    assert.deepEqual(extractManifestWrapperBindings(text), [], `${label} must not parse as a binding`);
  }
}

// Wrapper: a trailing comment after the complete sentinel is a real boundary;
// before the sentinel it is a missing-sentinel failure.
{
  const withComment = `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists -- # done`;
  assert.deepEqual(extractManifestWrapperBindings(withComment), [
    { workflow: ".github/workflows/slickcharts-weekly.yml", always: "always_if_exists", data: null },
  ]);
  const commentBeforeSentinel = `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists # comment`;
  assert.deepEqual(extractManifestWrapperBindings(commentBeforeSentinel), []);
}

// Wrapper: a post-sentinel data token must be a real shell word. An unquoted
// adjacent control operator (data/path&&echo, data/path||echo, data/path|cat,
// data/path;echo, data/path&echo) means the line does not end at the
// sentinel, so the binding must not be minted.
{
  for (const operator of ["&&", "||", "|", ";", "&"]) {
    const adjacent = `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists -- data/slickcharts/sp500.json${operator}echo`;
    assert.deepEqual(
      extractManifestWrapperBindings(adjacent),
      [],
      `post-sentinel adjacent ${operator} must reject the binding`,
    );
  }
}

// Wrapper: the same operators inside quotes or escapes are literal data-path
// characters in shell and must keep parsing as a binding.
{
  const literalTails = [
    ["double-quoted", '-- "data/slickcharts/sp500.json&&echo"'],
    ["single-quoted", "-- 'data/slickcharts/sp500.json||echo'"],
    ["escaped", String.raw`-- data/slickcharts/sp500.json\&\&echo`],
  ];
  for (const [label, tail] of literalTails) {
    const text = `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists ${tail}`;
    assert.deepEqual(
      extractManifestWrapperBindings(text),
      [
        {
          workflow: ".github/workflows/slickcharts-weekly.yml",
          always: "always_if_exists",
          data: null,
        },
      ],
      `${label} operator must stay literal in the data path`,
    );
  }
  // Only part of the operator escaped: the remaining `&` is still a real
  // background operator in shell, so the binding must be rejected.
  const partiallyEscaped = String.raw`scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists -- data/slickcharts/sp500.json\&&echo`;
  assert.deepEqual(extractManifestWrapperBindings(partiallyEscaped), []);
}

// Wrapper: quoted or fully escaped STANDALONE control literals after the
// sentinel are ordinary data arguments — never operators and never comments —
// so the binding is still minted.
{
  const base = `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists --`;
  const expected = {
    workflow: ".github/workflows/slickcharts-weekly.yml",
    always: "always_if_exists",
    data: null,
  };
  const literalTails = [
    ["double-quoted &&", `${base} "&&"`],
    ["single-quoted ||", `${base} '||'`],
    ["escaped &", `${base} \\&`],
    ["single-quoted ;", `${base} ';'`],
    ["double-quoted |", `${base} "|"`],
    ["double-quoted #", `${base} "#"`],
    ["single-quoted #comment", `${base} '#comment'`],
    ["double-quoted #comment", `${base} "#comment"`],
    ["escaped #comment", `${base} \\#comment`],
    ["mid-word hash", `${base} data/foo#bar.json`],
    ["empty-quote-prefixed hash", `${base} ""#comment`],
  ];
  for (const [label, text] of literalTails) {
    assert.deepEqual(extractManifestWrapperBindings(text), [expected], `${label} must stay an ordinary data argument`);
  }
  // The same literals must not hide a real operator: parsing continues past
  // them, so a genuine control token after a quoted/escaped `#` still rejects
  // the binding instead of truncating into a proof.
  for (const fakeComment of ["'#comment'", "\\#comment", '"#comment"']) {
    const text = `${base} ${fakeComment} && echo hi`;
    assert.deepEqual(extractManifestWrapperBindings(text), [], `operator after ${fakeComment} must reject the binding`);
  }
}

// Wrapper: a genuine unquoted word-initial `#` after the sentinel is still a
// real trailing comment boundary, with or without a space after the `#`.
{
  const base = `scripts/publish-slickcharts-attempt.sh weekly "$RUNNER_TEMP/w.json" "msg" --manifest-workflow .github/workflows/slickcharts-weekly.yml --manifest-always always_if_exists --`;
  const expected = {
    workflow: ".github/workflows/slickcharts-weekly.yml",
    always: "always_if_exists",
    data: null,
  };
  for (const commented of [`${base} # done`, `${base} #done-without-space`, `${base} #`]) {
    assert.deepEqual(extractManifestWrapperBindings(commented), [expected], `trailing comment must keep the binding: ${commented}`);
  }
}

// Helper: quoted or escaped '#comment' (and foo#bar) after a COMPLETE option
// stream is an extra argument, not a shell comment — the invocation must fail
// closed instead of being truncated into a false-green proof. The same holds
// for quoted standalone controls.
{
  for (const extra of ["'#comment'", '"#comment"', String.raw`\#comment`, "foo#bar", "'#'", '"&&"', "'||'", '"&"', "''#comment"]) {
    const text = `${exactInvocation.trim()} ${extra}`;
    assert.deepEqual(extractManifestStageInvocations(text), [], `${extra} must not mint an invocation`);
    const result = gate(text);
    assert.equal(result.ok, false, `${extra} must fail closed`);
    assert.ok(result.missing_in_workflow.some(({ shard }) => shard === PUBLISH_OUTCOME));
  }
}

// Helper: the shared tokenizer applies the same rule to option values, so an
// adjacent operator on the stage value is a chained command, never a proof.
{
  const adjacent = `${exactInvocation.trim().replace("--stage always_if_exists", "--stage always_if_exists&&echo")}`;
  assert.deepEqual(extractManifestStageInvocations(adjacent), []);
}

// End to end: the real weekly workflow stays green, and a tampered member or
// a reordered flag must fail the gate instead of borrowing the lane policy.
{
  const realWeekly = fs.readFileSync(path.join(REPO_ROOT, WEEKLY), "utf8");
  const clean = weeklyGate(realWeekly);
  assert.equal(clean.ok, true, JSON.stringify(clean));

  const wrongMember = realWeekly.replace(/\n            weekly \\\n/, "\n            daily \\\n");
  const wrongMemberResult = weeklyGate(wrongMember);
  assert.equal(wrongMemberResult.ok, false);
  assert.ok(
    wrongMemberResult.missing_in_workflow.some(
      ({ shard }) => shard === "data/admin/data-supply-state/publish-outcomes/slickcharts-weekly.json",
    ),
    "wrong member must lose the manifest-driven publish-outcome coverage",
  );

  const reordered = realWeekly.replace(
    "--manifest-workflow .github/workflows/slickcharts-weekly.yml \\\n            --manifest-always always_if_exists \\",
    "--manifest-always always_if_exists \\\n            --manifest-workflow .github/workflows/slickcharts-weekly.yml \\",
  );
  const reorderedResult = weeklyGate(reordered);
  assert.equal(reorderedResult.ok, false);
  assert.ok(reorderedResult.missing_in_workflow.length > 0, "reordered flags must lose manifest-driven coverage");
}

// Every primary owner must carry every admin shard its lanes declare. This is
// the fleet gate; the focused cases above prove that its helper evidence fails
// closed instead of borrowing another workflow's policy.
function assertOwnerFleet(registry) {
  for (const workflowRel of [...new Set(registry.lanes
    .map((lane) => lane.owner_workflow)
    .filter(Boolean))].sort()) {
    const workflowText = fs.readFileSync(path.join(REPO_ROOT, workflowRel), "utf8");
    const result = checkWorkflowCommitShardsAgainstRegistry({
      workflowText,
      workflowRel,
      registry,
      repoRoot: REPO_ROOT,
    });
    assert.equal(result.ok, true, `${workflowRel}: ${JSON.stringify(result)}`);
  }
}
assertOwnerFleet(LANE_REGISTRY);

const missingYahooOutcome = structuredClone(LANE_REGISTRY);
const yahooWorkflow = ".github/workflows/fetch-yf-finance.yml";
missingYahooOutcome.workflow_policies[yahooWorkflow].stages.always_if_exists =
  missingYahooOutcome.workflow_policies[yahooWorkflow].stages.always_if_exists
    .filter(({ path: pathValue }) => pathValue !== "data/admin/data-supply-state/publish-outcomes/yahoo-finance.json");
assert.throws(() => assertOwnerFleet(missingYahooOutcome), /yahoo-finance\.json/);

console.log("test-check-lane-registry-commit-shards: ok");
