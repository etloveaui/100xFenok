#!/usr/bin/env node
// Lane Registry ⇄ workflow commit-shard cross-check (BACKLOG #366, step 4).
//
// The false-green class: a producer writes a file that its workflow's git-add
// allowlist does not name — the run stays green and the data silently never
// persists. The registry's per-lane commit_shards is the declaration; this
// gate makes the workflow prove it covers them:
//   1. every declared admin commit shard of the workflow's OWN lanes must be
//      covered by the workflow's allowlist (the false-green direction);
//   2. every admin path in the allowlist must be covered by SOME registry
//      declaration — a lane's commit_shards, a lane's admin_store, or a
//      declared exception (the undeclared-commit direction).
// Workflows with no owning lane (central publishers like update-manifest, or
// owner-gated lanes like fenok-edge-krx-daily) are checked direction 2 only.
// Glob/dir allowlist entries are normalized; subpath coverage is explicit.
// Mismatch = loud fail (exit 1).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMIT_STAGE_KEYS,
  LANE_REGISTRY,
  declaredExceptionPaths,
} from "./lib/lane-registry.mjs";

const MANIFEST_HELPER_PATH = "scripts/stage-lane-manifest.sh";
const MANIFEST_WRAPPER_PATH = "scripts/publish-slickcharts-attempt.sh";
const SHELL_CONTROL_TOKENS = new Set(["#", ";", "&&", "||", "|", "&"]);
const MANIFEST_WRAPPER_MEMBER_PATTERN = /^[A-Za-z0-9_-]+$/;
const MANIFEST_VALUE_OPTIONS = new Set([
  "--workflow",
  "--stage",
  "--repo-root",
  "--manifest",
  "--expected-digest",
]);

function normalizeAllowlistPath(pathValue) {
  return pathValue.replace(/\*.*$/, "").replace(/\/+$/, "");
}

function normalizeShellContinuations(sourceText) {
  return sourceText.replace(/\\[ \t]*\r?\n[ \t]*/g, " ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenizeShellCommand(commandText) {
  const tokens = [];
  let token = "";
  // Provenance of the current token: whether its FIRST character came from a
  // quote/escape construct (so a later unquoted `#` is mid-word, not a comment
  // start), and whether ANY character did (so a quoted/escaped operator copy
  // is literal data, never a real control operator).
  let tokenStartQuotedOrEscaped = false;
  let tokenSawQuoteOrEscape = false;
  let quote = null;
  let escaped = false;

  const flushToken = () => {
    if (token.length > 0) {
      tokens.push({
        text: token,
        startQuotedOrEscaped: tokenStartQuotedOrEscaped,
        sawQuoteOrEscape: tokenSawQuoteOrEscape,
      });
      token = "";
      tokenStartQuotedOrEscaped = false;
      tokenSawQuoteOrEscape = false;
    }
  };

  for (let position = 0; position < commandText.length; position += 1) {
    const character = commandText[position];
    if (escaped) {
      if (token.length === 0) tokenStartQuotedOrEscaped = true;
      token += character;
      tokenSawQuoteOrEscape = true;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (character === "'") quote = null;
      else {
        if (token.length === 0) tokenStartQuotedOrEscaped = true;
        token += character;
        tokenSawQuoteOrEscape = true;
      }
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = null;
      else if (character === "\\") escaped = true;
      else {
        if (token.length === 0) tokenStartQuotedOrEscaped = true;
        token += character;
        tokenSawQuoteOrEscape = true;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      // A word may begin with a quoted segment, even an empty one; a `#` after
      // it (""#comment) is still mid-word, so it must not become a comment.
      if (token.length === 0) tokenStartQuotedOrEscaped = true;
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      flushToken();
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    // Control operators are split out whenever they appear OUTSIDE quotes and
    // escapes, with or without surrounding whitespace. Shell treats
    // `data/path&&echo` as two commands, not one word, so a single merged
    // token would let a post-sentinel operator slip past the control-token
    // checks and mint a false binding. Quoted/escaped operators stay inside
    // the token because they are literal data there; the provenance flags
    // keep that distinction after the token text is unquoted.
    const twoCharacterOperator = commandText.slice(position, position + 2);
    if (twoCharacterOperator === "&&" || twoCharacterOperator === "||") {
      flushToken();
      tokens.push({ text: twoCharacterOperator, startQuotedOrEscaped: false, sawQuoteOrEscape: false });
      position += 1;
      continue;
    }
    if (character === "&" || character === "|" || character === ";") {
      flushToken();
      tokens.push({ text: character, startQuotedOrEscaped: false, sawQuoteOrEscape: false });
      continue;
    }
    token += character;
  }

  if (quote !== null || escaped) return null;
  flushToken();
  return tokens;
}

function isConcreteManifestValue(value) {
  return typeof value === "string"
    && value.length > 0
    && !/[`$();|&<>{}[\]*?!]/.test(value);
}

function isShellCommentBoundary(token) {
  // A real shell comment begins only when an unquoted/unescaped `#` starts a
  // word: everything after it on the line is ignored and the command
  // legitimately ends there. Quoted ('#comment'), escaped (\#comment), and
  // mid-word (foo#bar) hashes are ordinary argument characters.
  return typeof token === "object"
    && token !== null
    && typeof token.text === "string"
    && token.text.startsWith("#")
    && token.startQuotedOrEscaped === false;
}

function isControlOperator(token) {
  // Only an operator that reached the tokenizer unquoted and unescaped is a
  // shell control operator; quoted or escaped copies are literal data.
  return typeof token === "object"
    && token !== null
    && SHELL_CONTROL_TOKENS.has(token.text)
    && token.sawQuoteOrEscape === false;
}

function isValidManifestFlagValue(value) {
  return typeof value === "object"
    && value !== null
    && typeof value.text === "string"
    && value.text.length > 0
    && !isShellCommentBoundary(value)
    && !isControlOperator(value)
    && !value.text.startsWith("-")
    && isConcreteManifestValue(value.text);
}

function parseManifestHelperTokens(tokens) {
  if (!Array.isArray(tokens) || tokens[0]?.text !== MANIFEST_HELPER_PATH) return null;
  const values = { workflow: null, stage: null };
  const seen = new Set();

  for (let index = 1; index < tokens.length; index += 1) {
    const option = tokens[index];
    // An unquoted word-initial `#` is a shell comment boundary; the rest of
    // the line is ignored, so the command may validly end here. Quoted or
    // escaped `#` words are ordinary arguments and are handled below.
    if (isShellCommentBoundary(option)) break;
    // Any other shell control operator inside the command means the helper is
    // embedded in (or dangling from) a larger command. Truncating at it would
    // mint a false-green proof, so reject the whole command instead.
    if (isControlOperator(option)) return null;
    if (!MANIFEST_VALUE_OPTIONS.has(option.text)) return null;
    if (seen.has(option.text)) return null;
    seen.add(option.text);
    const value = tokens[index + 1];
    if (value === undefined || isShellCommentBoundary(value)) break;
    if (isControlOperator(value)) return null;
    values[option.text.slice(2)] = value.text;
    index += 1;
  }

  if (values.workflow === null || values.stage === null) return null;
  return {
    workflow: values.workflow,
    stage: values.stage,
    exact: isConcreteManifestValue(values.workflow)
      && isConcreteManifestValue(values.stage)
      && COMMIT_STAGE_KEYS.includes(values.stage),
  };
}

function extractCommandTokens(sourceText, commandPath) {
  if (typeof sourceText !== "string") return [];
  const normalized = normalizeShellContinuations(sourceText);
  const commandPattern = new RegExp(`^[ \\t]*(?:bash[ \\t]+)?${escapeRegExp(commandPath)}(?:[ \\t]+|$)`);
  const commands = [];
  for (const line of normalized.split(/\r?\n/)) {
    if (!commandPattern.test(line)) continue;
    const command = line.trim();
    const tokens = tokenizeShellCommand(command);
    if (tokens !== null) commands.push(tokens);
  }
  return commands;
}

function extractManifestHelperCalls(sourceText) {
  return extractCommandTokens(sourceText, MANIFEST_HELPER_PATH)
    .map((tokens) => parseManifestHelperTokens(tokens))
    .filter(Boolean);
}

export function extractManifestStageInvocations(sourceText) {
  return extractManifestHelperCalls(sourceText)
    .filter((invocation) => invocation.exact)
    .map(({ workflow, stage }) => ({ workflow, stage }));
}

function parseManifestWrapperTokens(tokens) {
  if (!Array.isArray(tokens) || tokens[0]?.text !== MANIFEST_WRAPPER_PATH) return null;
  if (tokens.length < 4) return null;
  const member = tokens[1];
  const rowPath = tokens[2];
  const commitMessage = tokens[3];
  // The publisher requires <member> <row-json> <commit-message> before any
  // manifest options; without them the invocation cannot be a manifest proof.
  if (!MANIFEST_WRAPPER_MEMBER_PATTERN.test(member.text)) return null;
  for (const positional of [rowPath, commitMessage]) {
    if (isShellCommentBoundary(positional) || isControlOperator(positional)) return null;
  }

  let index = 4;
  const next = tokens[index];
  if (next === undefined || isShellCommentBoundary(next)) {
    // Bare invocation (or a trailing comment): valid wrapper usage, but no
    // manifest block was requested, so it proves no manifest coverage.
    return null;
  }
  // The publisher accepts manifest options only as the exact sequence
  // --manifest-workflow <workflow> --manifest-always <stage>
  // [--manifest-data <stage>] -- ; anything else is a data path or a
  // rejected option, never a manifest binding.
  if (next.text !== "--manifest-workflow") return null;
  const workflow = tokens[index + 1];
  if (!isValidManifestFlagValue(workflow)) return null;
  index += 2;
  if (tokens[index]?.text !== "--manifest-always") return null;
  const always = tokens[index + 1];
  if (!isValidManifestFlagValue(always) || !COMMIT_STAGE_KEYS.includes(always.text)) return null;
  index += 2;
  let data = null;
  if (tokens[index]?.text === "--manifest-data") {
    const dataValue = tokens[index + 1];
    if (!isValidManifestFlagValue(dataValue) || !COMMIT_STAGE_KEYS.includes(dataValue.text)) return null;
    data = dataValue.text;
    index += 2;
  }
  if (tokens[index]?.text !== "--") return null;
  index += 1;
  // After the sentinel the publisher treats every argument as a data path for
  // git add. Options there are never manifest options, and any control
  // operator that is genuinely unquoted means the command does not end at the
  // sentinel. Quoted or escaped operator copies stay ordinary data arguments.
  for (; index < tokens.length; index += 1) {
    const tail = tokens[index];
    if (isShellCommentBoundary(tail)) break;
    if (isControlOperator(tail)) return null;
    if (tail.text.startsWith("-")) return null;
  }
  // The publisher itself exits when --manifest-workflow does not match
  // .github/workflows/slickcharts-<member>.yml; a mismatched member must not
  // borrow another caller's policy.
  const expectedWorkflow = `.github/workflows/slickcharts-${member.text}.yml`;
  if (workflow.text !== expectedWorkflow) return null;
  return { workflow: workflow.text, always: always.text, data };
}

export function extractManifestWrapperBindings(sourceText) {
  return extractCommandTokens(sourceText, MANIFEST_WRAPPER_PATH)
    .map((tokens) => parseManifestWrapperTokens(tokens))
    .filter(Boolean);
}

function policyAdminPaths(registry, workflowRel, stage) {
  const policy = registry.workflow_policies?.[workflowRel];
  if (!policy || !Array.isArray(policy.stages?.[stage])) return [];
  return policy.stages[stage]
    .map((spec) => normalizeAllowlistPath(spec.path))
    .filter((pathValue) => pathValue.startsWith("data/admin/"));
}

function manifestDrivenAllowlist({ workflowText, workflowRel, scriptTexts, registry }) {
  const exactInvocations = [
    ...extractManifestStageInvocations(workflowText),
    ...scriptTexts.flatMap((sourceText) => extractManifestStageInvocations(sourceText)),
  ];
  const paths = exactInvocations
    .filter(({ workflow }) => workflow === workflowRel)
    .flatMap(({ stage }) => policyAdminPaths(registry, workflowRel, stage));

  // SlickCharts calls the helper through a declared shell publisher. Treat
  // that path as proven only when the publisher source passes its exact helper
  // variables through and the caller supplies concrete workflow/stage values.
  const helperVariables = scriptTexts
    .flatMap((sourceText) => extractManifestHelperCalls(sourceText))
    .filter((invocation) => invocation.workflow === "$manifest_workflow"
      && ["$manifest_always", "$manifest_data"].includes(invocation.stage));
  if (helperVariables.length > 0) {
    for (const binding of extractManifestWrapperBindings(workflowText)) {
      if (binding.workflow !== workflowRel) continue;
      if (helperVariables.some((invocation) => invocation.stage === "$manifest_always")) {
        paths.push(...policyAdminPaths(registry, workflowRel, binding.always));
      }
      if (binding.data !== null
        && helperVariables.some((invocation) => invocation.stage === "$manifest_data")) {
        paths.push(...policyAdminPaths(registry, workflowRel, binding.data));
      }
    }
  }
  return [...new Set(paths)].sort();
}

export function extractWorkflowShardAllowlist(workflowText, { required = true } = {}) {
  // Whole-file scan: workflows commit admin state via SHARD loops, standalone
  // git add lines, globs, or var assignments — the allowlist is every
  // data/admin/ path literal in the file, normalized (globs collapsed to their
  // static prefix). Non-admin canonical/public paths are out of scope.
  const matches = [...workflowText.matchAll(/data\/admin\/[^\s"';\\]+/g)]
    .map((match) => normalizeAllowlistPath(match[0]));
  const unique = [...new Set(matches)].sort();
  if (required && unique.length === 0) throw new Error("no data/admin shard paths found in workflow text");
  return unique;
}

function coversAny(path, declaredSet) {
  if (declaredSet.has(path)) return true;
  for (const declared of declaredSet) {
    if (path.startsWith(`${declared}/`) || declared.startsWith(`${path}/`)) return true;
  }
  return false;
}

function coveredByRegistry(path, declaredSet) {
  if (declaredSet.has(path)) return true;
  for (const declared of declaredSet) {
    if (path.startsWith(`${declared}/`)) return true;
  }
  return false;
}

export function checkWorkflowCommitShardsAgainstRegistry({
  workflowText,
  workflowRel,
  registry = LANE_REGISTRY,
  repoRoot = null,
}) {
  if (typeof workflowRel !== "string" || !workflowRel.startsWith(".github/workflows/")) {
    throw new Error("workflowRel must be a .github/workflows/ path");
  }
  // Scope resolution: a lane's primary owner_workflow, a declared caller
  // workflow (shared-lane families like slickcharts), or a declared
  // workflow_class for lane-less central/owner-gated workflows.
  const primaryLanes = registry.lanes.filter((lane) => lane.owner_workflow === workflowRel);
  let scope = null;
  if (primaryLanes.length > 0) {
    scope = {
      kind: "primary",
      lanes: primaryLanes,
      commit_shards: primaryLanes.flatMap((lane) => lane.commit_shards),
      script_sources: primaryLanes.flatMap((lane) => lane.script_sources ?? []),
    };
  } else {
    for (const lane of registry.lanes) {
      const caller = lane.caller_workflows?.[workflowRel];
      if (caller) {
        scope = {
          kind: "caller",
          lanes: [lane],
          commit_shards: caller.commit_shards,
          script_sources: caller.script_sources,
        };
        break;
      }
    }
  }
  const lanes = scope?.lanes ?? [];
  const workflowClass = registry.workflow_classes?.[workflowRel] ?? null;
  const scriptSources = scope?.script_sources ?? [];
  // A declared platform workflow may legitimately publish only canonical or
  // public paths (for example build-stocks-analyzer.yml), so the legacy admin
  // extractor must not fail before the new full manifest gate can evaluate it.
  // Lane-owned workflows and undeclared lane-less workflows retain the old
  // fail-closed requirement.
  const allowlist = extractWorkflowShardAllowlist(workflowText, {
    required: scope === null && workflowClass === null ? scriptSources.length === 0 : false,
  });
  if (scope === null && workflowClass === null) {
    return {
      ok: false,
      workflow: workflowRel,
      lanes: [],
      workflow_class: null,
      missing_in_workflow: [],
      undeclared_in_workflow: [],
      reason: "lane-less workflow with no declared workflow_class (DEC-266: declared, not inferred)",
      allowlist_count: allowlist.length,
      declared_count: 0,
    };
  }

  // Script-side publishers: a lane may commit via a shell script instead of
  // inline YAML git-add lines (the slickcharts family). Declared script sources
  // are scanned alongside the workflow text when repoRoot is provided.
  let allowlistAll = allowlist;
  const scriptTexts = [];
  if (scriptSources.length > 0) {
    if (repoRoot === null) throw new Error("repoRoot is required to scan declared script_sources");
    for (const sourcePath of scriptSources) {
      const sourceText = fs.readFileSync(path.join(repoRoot, sourcePath), "utf8");
      scriptTexts.push(sourceText);
      // A declared source may build paths from constants while a sibling source
      // or the workflow carries the literal allowlist. Require coverage from the
      // combined scope below, not independently from every implementation file.
      const scriptAllowlist = extractWorkflowShardAllowlist(sourceText, { required: false });
      allowlistAll = [...new Set([...allowlistAll, ...scriptAllowlist])].sort();
    }
  }
  allowlistAll = [...new Set([
    ...allowlistAll,
    ...manifestDrivenAllowlist({ workflowText, workflowRel, scriptTexts, registry }),
  ])].sort();

  // Direction 1 (false-green): the scope's declared admin shards must be
  // covered by the combined allowlist.
  const ownDeclared = new Map();
  for (const lane of lanes) {
    const shards = scope.kind === "caller" ? scope.commit_shards : lane.commit_shards;
    for (const shard of shards) {
      // Gate scope is admin control-plane state; canonical/public mirrors of a
      // lane are tracked on the registry's public_mirror axis instead.
      if (shard.startsWith("data/admin/")) ownDeclared.set(shard, lane.id);
    }
  }
  const allowSet = new Set(allowlistAll);
  const missing_in_workflow = [...ownDeclared.entries()]
    .filter(([shard]) => !coversAny(shard, allowSet))
    .map(([shard, lane]) => ({ shard, lane }));

  // Direction 2 (undeclared-commit): every allowlist entry must be covered by
  // some registry declaration (lane commit_shards, lane admin_store, or a
  // declared exception).
  const registryDeclared = new Set();
  for (const lane of registry.lanes) {
    for (const shard of lane.commit_shards) {
      if (shard.startsWith("data/admin/")) registryDeclared.add(shard);
    }
    if (lane.roots.admin_store !== null) registryDeclared.add(lane.roots.admin_store);
  }
  for (const exception of declaredExceptionPaths(null, registry)) registryDeclared.add(exception);
  const undeclared_in_workflow = allowlistAll.filter((entry) => !coveredByRegistry(entry, registryDeclared));

  return {
    ok: missing_in_workflow.length === 0 && undeclared_in_workflow.length === 0,
    workflow: workflowRel,
    lanes: lanes.map((lane) => lane.id),
    scope: scope?.kind ?? "platform",
    workflow_class: workflowClass?.class ?? null,
    missing_in_workflow,
    undeclared_in_workflow,
    allowlist_count: allowlistAll.length,
    declared_count: ownDeclared.size,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const workflowRel = process.argv[2] ?? ".github/workflows/fenok-edge-daily.yml";
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkWorkflowCommitShardsAgainstRegistry({
    workflowText: fs.readFileSync(path.join(repoRoot, workflowRel), "utf8"),
    workflowRel,
    repoRoot,
  });
  for (const row of result.missing_in_workflow) {
    console.error(`::error:: lane-registry gate: ${row.shard} (lane ${row.lane}) is declared but NOT git-added by ${result.workflow} (the false-green class)`);
  }
  for (const shard of result.undeclared_in_workflow) {
    console.error(`::error:: lane-registry gate: ${result.workflow} git-adds ${shard} but no registry declaration covers it`);
  }
  if (!result.ok) process.exit(1);
  console.log(`lane-registry commit-shard gate: ok (${result.workflow}; lanes ${result.lanes.join(",") || "none (central/owner-gated)"}; ${result.declared_count} own declared shards, ${result.allowlist_count} allowlist entries, all matched)`);
}
