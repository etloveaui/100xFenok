#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const filePath = process.argv[2];

if (!filePath || filePath === "-h" || filePath === "--help") {
  console.error("Usage: node scripts/score-mona-session.mjs data/voice-logs/<session>.json");
  process.exit(filePath ? 0 : 2);
}

const absolutePath = path.resolve(process.cwd(), filePath);
let raw;
try {
  raw = fs.readFileSync(absolutePath, "utf8");
} catch (error) {
  console.error(`Unable to read log file: ${absolutePath}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

let session;
try {
  session = JSON.parse(raw);
} catch (error) {
  console.error(`Unable to parse JSON log file: ${absolutePath}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const NEW_MATERIAL_PATTERNS = [
  /새로운/,
  /새\s*문장/,
  /다음\s*[가거것]?/,
  /더\s*(해|줘|주|하자|하고)/,
  /\b(next|more|another|different|new one)\b/i,
];

const EASIER_PATTERNS = [
  /쉬운/,
  /쉽게/,
  /더\s*쉬/,
  /너무\s*어려/,
  /\b(easier|too hard|easy one|simpler)\b/i,
];

const HARDER_PATTERNS = [
  /어려운/,
  /더\s*어려/,
  /어렵게/,
  /너무\s*쉬/,
  /\b(harder|too easy|hard one|more difficult)\b/i,
];

const STOP_PATTERNS = [
  /그만/,
  /끝/,
  /멈춰/,
  /종료/,
  /\b(stop|done|quit|finish|enough)\b/i,
];

const PRAISE_PATTERNS = [
  /잘했/,
  /맞았/,
  /완벽/,
  /좋았/,
  /좋아/,
  /대단/,
  /훌륭/,
  /자연스럽/,
  /비슷했/,
  /\b(good|great|perfect|excellent|nice|close)\b/i,
];

const REPEAT_PATTERNS = [
  /다시/,
  /한\s*번/,
  /못\s*들/,
  /안\s*들/,
  /잘\s*안\s*들/,
  /또박/,
  /\b(repeat|again|say it|try again)\b/i,
];

const HIJACK_PATTERNS = [
  /새로\s*만들지\s*마/,
  /종합\s*복습/,
];

const CLOSING_PATTERNS = [
  /여기까지/,
  /마무리/,
  /잘\s*자/,
  /푹\s*쉬/,
  /내일\s*또/,
  /끝낼게/,
  /\b(good night|see you|wrap up|sleep well)\b/i,
];

const GARBLED_PATTERNS = [
  /usted/i,
  /\balgo\b/i,
  /\btu watch\b/i,
  /\banything grown\b/i,
];

const entries = normalizeEntries(session);
const turns = buildTurns(entries);
const metrics = asObject(session.metrics);
const settings = asObject(session.settings);
const state = asObject(
  session.coachSessionState ??
    settings.coachSessionState ??
    metrics.coachSessionState ??
    metrics.sessionState,
);
const telemetry = collectTelemetry(metrics, settings, state);
const preV3 = telemetry.phase6Keys.length === 0;

const gates = [
  scoreNewMaterialGate(entries, telemetry, preV3),
  scoreDifficultyGate(entries, telemetry, preV3),
  scoreEmptyPraiseGuardGate(entries, turns, telemetry, preV3),
  scoreReviewHijackGate(entries, telemetry, preV3),
  scoreClosingGate(entries, turns, preV3),
];

const scoredGates = gates.filter((gate) => gate.status === "scored");
const failedGates = scoredGates.filter((gate) => !gate.pass);
const naGates = gates.filter((gate) => gate.status !== "scored");

const scorecard = {
  meta: {
    file: path.relative(process.cwd(), absolutePath),
    sessionId: session.sessionId ?? session.id ?? null,
    mode: session.mode ?? null,
    schemaVersion: session.schemaVersion ?? null,
    logCount: Array.isArray(session.logs) ? session.logs.length : 0,
    transcriptCount: Array.isArray(session.transcript) ? session.transcript.length : 0,
    phase6TelemetryPresent: !preV3,
    phase6Keys: telemetry.phase6Keys,
  },
  overall: {
    pass: failedGates.length === 0,
    status: scoredGates.length === 0 ? "n/a" : failedGates.length === 0 ? "pass" : "fail",
    scored: scoredGates.length,
    failed: failedGates.length,
    na: naGates.length,
  },
  gates,
};

console.log(JSON.stringify(scorecard, null, 2));

function normalizeEntries(log) {
  if (Array.isArray(log.logs) && log.logs.length > 0) {
    return log.logs.map((entry, index) => {
      const rawRole = String(entry?.role ?? "unknown");
      return {
        seq: entry?.seq ?? index + 1,
        role: normalizeRole(rawRole),
        rawRole,
        text: String(entry?.text ?? ""),
        atIso: entry?.atIso ?? null,
      };
    });
  }

  if (Array.isArray(log.transcript)) {
    return log.transcript.map((entry, index) => {
      const speaker = String(entry?.speaker ?? "unknown");
      return {
        seq: `t${index + 1}`,
        role: normalizeRole(speaker),
        rawRole: speaker,
        text: String(entry?.text ?? ""),
        atIso: entry?.atIso ?? null,
      };
    });
  }

  return [];
}

function normalizeRole(role) {
  const normalized = role.toLowerCase();
  if (normalized === "user") return "user";
  if (["bench", "model", "assistant", "coach"].includes(normalized)) return "coach";
  if (normalized === "tool") return "tool";
  return "system";
}

function buildTurns(normalizedEntries) {
  const result = [];
  let current = null;

  for (const entry of normalizedEntries) {
    if (entry.role !== "user" && entry.role !== "coach") continue;
    if (!current || current.role !== entry.role) {
      current = {
        role: entry.role,
        entries: [],
      };
      result.push(current);
    }
    current.entries.push(entry);
  }

  return result.map((turn, index) => ({
    index,
    role: turn.role,
    text: turn.entries.map((entry) => entry.text).join(" ").replace(/\s+/g, " ").trim(),
    entries: turn.entries,
    seqRefs: turn.entries.map((entry) => entry.seq),
  }));
}

function collectTelemetry(metricSource, settingSource, stateSource) {
  const phase6Keys = [];

  const lessonMaterialToolCalls = pickNumber(
    ["lessonMaterialToolCalls", "lessonMaterialCallCount", "requestLessonMaterialCalls"],
    metricSource,
    stateSource,
  );
  const lessonMaterialLastReturnedCount = pickNumber(
    ["lessonMaterialLastReturnedCount", "lessonMaterialReturnedCount", "lessonMaterialItemCount"],
    metricSource,
    stateSource,
  );
  const reviewCountActual = pickNumber(["reviewCountActual", "reviewItemCount"], metricSource, stateSource);
  const newCountActual = pickNumber(["newCountActual", "newItemCount"], metricSource, stateSource);

  const clientIntentHint = pickValue(["clientIntentHint", "clientToolIntent"], metricSource, stateSource);
  const modelToolIntent = pickValue(["modelToolIntent", "modelIntent", "toolIntent"], metricSource, stateSource);
  const intentHintMatched = pickValue(["intentHintMatched", "clientIntentMatched"], metricSource, stateSource);
  const lessonMaterialLastIntent = pickValue(
    ["lessonMaterialLastIntent", "lessonMaterialIntent", "requestLessonMaterialIntent"],
    metricSource,
    stateSource,
  );
  const lessonMaterialLastSource = pickValue(
    ["lessonMaterialLastSource", "lessonMaterialSource"],
    metricSource,
    stateSource,
  );
  const lessonMaterialLastItemKey = pickValue(
    ["lessonMaterialLastItemKey", "lessonMaterialItemKey", "currentItemKey", "lastItemKey"],
    metricSource,
    stateSource,
  );

  const previousDifficulty = pickValue(["previousDifficulty", "fromDifficulty"], metricSource, stateSource);
  const nextDifficulty = pickValue(
    ["lessonMaterialLastDifficulty", "nextDifficulty", "toDifficulty", "currentDifficulty"],
    metricSource,
    stateSource,
  );
  const difficultyShift = pickValue(["difficultyShift", "lessonMaterialDifficultyShift"], metricSource, stateSource);
  const garbledTranscriptCount = pickNumber(["garbledTranscriptCount", "garbledUserTranscriptCount"], metricSource);
  const emptyTranscriptCount = pickNumber(["emptyTranscriptCount", "emptyUserTranscriptCount"], metricSource);

  const bufferedItemKeys = pickArray(["bufferedItemKeys", "lessonMaterialBufferedItemKeys"], metricSource, stateSource);
  const seenItemKeysBefore = pickArray(["seenItemKeysBefore", "lessonMaterialSeenItemKeysBefore"], metricSource, stateSource);
  const seenItemKeys = pickArray(["seenItemKeys", "lessonMaterialSeenItemKeys"], metricSource, stateSource);

  for (const [name, value] of Object.entries({
    lessonMaterialToolCalls,
    lessonMaterialLastReturnedCount,
    reviewCountActual,
    newCountActual,
    clientIntentHint,
    modelToolIntent,
    intentHintMatched,
    lessonMaterialLastIntent,
    lessonMaterialLastSource,
    lessonMaterialLastItemKey,
    previousDifficulty,
    nextDifficulty,
    difficultyShift,
    garbledTranscriptCount,
    emptyTranscriptCount,
    bufferedItemKeys,
    seenItemKeysBefore,
    seenItemKeys,
  })) {
    if (value !== undefined) phase6Keys.push(name);
  }

  return {
    phase6Keys: [...new Set(phase6Keys)],
    lessonMaterialToolCalls,
    lessonMaterialLastReturnedCount,
    reviewCountActual,
    newCountActual,
    clientIntentHint,
    modelToolIntent,
    intentHintMatched,
    lessonMaterialLastIntent,
    lessonMaterialLastSource,
    lessonMaterialLastItemKey,
    previousDifficulty,
    nextDifficulty,
    difficultyShift,
    garbledTranscriptCount,
    emptyTranscriptCount,
    bufferedItemKeys,
    seenItemKeysBefore,
    seenItemKeys,
    requestLessonMaterialEnabled:
      includesString(settingSource.enabledToolIds, "requestLessonMaterial") ||
      includesString(settingSource.enabledToolIds, "mona-request-lesson-material"),
  };
}

function scoreNewMaterialGate(normalizedEntries, data, isPreV3) {
  const requests = normalizedEntries.filter((entry) => entry.role === "user" && containsAny(entry.text, NEW_MATERIAL_PATTERNS));
  if (requests.length === 0) {
    return gate("G1", false, "n/a", ["No new-material learner request detected."], []);
  }
  if (isPreV3) {
    return preV3Gate("G1", "New-material learner request exists, but requestLessonMaterial/new-item telemetry is absent.", requests);
  }

  const toolRefs = requests.flatMap((request) =>
    entriesAfterUntilNextUser(normalizedEntries, request).filter(
      (entry) => entry.role === "tool" && /requestLessonMaterial/i.test(entry.text) && /new|more|next|material|새|다음|더/i.test(entry.text),
    ),
  );
  const intentValues = [
    data.clientIntentHint,
    data.modelToolIntent,
    data.lessonMaterialLastIntent,
  ].map(normalizeIntent);
  const materialIntent = intentValues.some((intent) => ["new", "more", "next", "new_material"].includes(intent));
  const returnedMaterial = numberOrZero(data.lessonMaterialLastReturnedCount) > 0 || numberOrZero(data.lessonMaterialToolCalls) > 0;
  const source = String(data.lessonMaterialLastSource ?? "").toLowerCase();
  const bufferOrToolSource = ["buffer", "tool", "generated", "lesson", "new"].some((token) => source.includes(token));
  const repeatVerdict = itemRepeatVerdict(data);
  const pass = (toolRefs.length > 0 || (materialIntent && returnedMaterial && bufferOrToolSource)) && repeatVerdict.pass !== false;

  return gate("G1", pass, "scored", [
    `newRequests=${requests.length}`,
    `toolCallRefs=${toolRefs.map((entry) => entry.seq).join(",") || "none"}`,
    `intent=${intentValues.filter(Boolean).join("/") || "none"}`,
    `source=${data.lessonMaterialLastSource ?? "unknown"}`,
    `returnedCount=${data.lessonMaterialLastReturnedCount ?? "unknown"}`,
    repeatVerdict.evidence,
  ], uniqueSeqs([...requests, ...toolRefs]));
}

function scoreDifficultyGate(normalizedEntries, data, isPreV3) {
  const requests = normalizedEntries
    .filter((entry) => entry.role === "user")
    .map((entry) => ({
      entry,
      direction: containsAny(entry.text, EASIER_PATTERNS)
        ? "easier"
        : containsAny(entry.text, HARDER_PATTERNS)
          ? "harder"
          : null,
    }))
    .filter((request) => request.direction);

  if (requests.length === 0) {
    return gate("G2", false, "n/a", ["No easier/harder learner request detected."], []);
  }
  if (isPreV3) {
    return preV3Gate("G2", "Difficulty learner request exists, but difficulty/material telemetry is absent.", requests.map((request) => request.entry));
  }

  const requestedDirection = requests.at(-1).direction;
  const toolRefs = requests.flatMap(({ entry }) =>
    entriesAfterUntilNextUser(normalizedEntries, entry).filter(
      (candidate) =>
        candidate.role === "tool" &&
        /requestLessonMaterial/i.test(candidate.text) &&
        /easy|hard|difficulty|쉬|어려/i.test(candidate.text),
    ),
  );
  const intentValues = [
    data.clientIntentHint,
    data.modelToolIntent,
    data.lessonMaterialLastIntent,
    data.difficultyShift,
  ].map(normalizeIntent);
  const intentMatches = intentValues.includes(requestedDirection);
  const explicitShift = compareDifficulty(data.previousDifficulty, data.nextDifficulty);
  const explicitMatches = explicitShift ? explicitShift === requestedDirection : undefined;
  const returnedMaterial = numberOrZero(data.lessonMaterialLastReturnedCount) > 0 || numberOrZero(data.lessonMaterialToolCalls) > 0;
  const pass = (toolRefs.length > 0 || intentMatches) && returnedMaterial && explicitMatches !== false;

  return gate("G2", pass, "scored", [
    `requested=${requestedDirection}`,
    `toolCallRefs=${toolRefs.map((entry) => entry.seq).join(",") || "none"}`,
    `intent=${intentValues.filter(Boolean).join("/") || "none"}`,
    `returnedCount=${data.lessonMaterialLastReturnedCount ?? "unknown"}`,
    `difficulty=${data.previousDifficulty ?? "unknown"}->${data.nextDifficulty ?? "unknown"}`,
    explicitMatches === undefined ? "explicit difficulty values unavailable; using tool intent/material return as evidence" : `explicitShift=${explicitShift}`,
  ], uniqueSeqs([...requests.map((request) => request.entry), ...toolRefs]));
}

function scoreEmptyPraiseGuardGate(normalizedEntries, normalizedTurns, data, isPreV3) {
  if (isPreV3) {
    return gate("G3", false, "n/a, pre-v3", [
      "pre-v3 log: missing Phase 6 guardrail telemetry; emptyPraiseGuard cannot be graded safely.",
      `textDetectedGarbledSeqs=${normalizedEntries.filter((entry) => entry.role === "user" && isGarbled(entry.text)).map((entry) => entry.seq).join(",") || "none"}`,
    ], []);
  }

  const metricCount = numberOrZero(data.garbledTranscriptCount) + numberOrZero(data.emptyTranscriptCount);
  const garbledEntries = normalizedEntries.filter((entry) => entry.role === "user" && isGarbled(entry.text));
  if (metricCount === 0 && garbledEntries.length === 0) {
    return gate("G3", true, "scored", ["No garbled/empty user transcription detected."], []);
  }

  const checks = garbledEntries.map((entry) => {
    const nextCoachTurn = nextTurnAfterEntry(normalizedTurns, entry, "coach");
    const coachText = nextCoachTurn?.text ?? "";
    return {
      entry,
      nextCoachTurn,
      hasPraise: containsAny(coachText, PRAISE_PATTERNS),
      asksRepeat: containsAny(coachText, REPEAT_PATTERNS),
    };
  });
  const pass = checks.length > 0 && checks.every((check) => !check.hasPraise && check.asksRepeat);
  const seqRefs = uniqueSeqs(checks.flatMap((check) => [check.entry, ...(check.nextCoachTurn?.entries ?? [])]));

  return gate("G3", pass, "scored", [
    `metricGarbledOrEmptyCount=${metricCount}`,
    `textDetectedGarbledSeqs=${garbledEntries.map((entry) => entry.seq).join(",") || "none"}`,
    `violations=${checks.filter((check) => check.hasPraise || !check.asksRepeat).map((check) => check.entry.seq).join(",") || "none"}`,
  ], seqRefs);
}

function scoreReviewHijackGate(normalizedEntries, data, isPreV3) {
  const hijackEntries = normalizedEntries.filter(
    (entry) => entry.role === "coach" && containsAny(entry.text, HIJACK_PATTERNS),
  );

  if (isPreV3) {
    return gate("G4", false, "n/a, pre-v3", [
      "pre-v3 log: missing reviewCountActual/newCountActual telemetry; review minority cannot be graded safely.",
      `hijackTextRefs=${hijackEntries.map((entry) => entry.seq).join(",") || "none"}`,
    ], uniqueSeqs(hijackEntries));
  }

  const reviewCount = toNumber(data.reviewCountActual);
  const newCount = toNumber(data.newCountActual);
  const hasCounts = Number.isFinite(reviewCount) && Number.isFinite(newCount);
  const reviewMinority = hasCounts ? reviewCount < newCount : false;
  const pass = hijackEntries.length === 0 && reviewMinority;

  return gate("G4", pass, hasCounts ? "scored" : "n/a", [
    `hijackTextRefs=${hijackEntries.map((entry) => entry.seq).join(",") || "none"}`,
    hasCounts ? `reviewCountActual=${reviewCount}` : "reviewCountActual=missing",
    hasCounts ? `newCountActual=${newCount}` : "newCountActual=missing",
    hasCounts ? `reviewMinority=${reviewMinority}` : "review minority unavailable without counts",
  ], uniqueSeqs(hijackEntries));
}

function scoreClosingGate(normalizedEntries, normalizedTurns, isPreV3) {
  const stopEntries = normalizedEntries.filter((entry) => entry.role === "user" && containsAny(entry.text, STOP_PATTERNS));
  if (stopEntries.length === 0) {
    return gate("G5", false, "n/a", ["No stop/finish learner request detected."], []);
  }
  if (isPreV3) {
    return preV3Gate("G5", "Stop request exists, but one-closing guardrail telemetry is absent.", stopEntries);
  }

  const firstStop = stopEntries[0];
  const stopTurnIndex = turnIndexForEntry(normalizedTurns, firstStop);
  const coachTurnsAfterStop = normalizedTurns
    .slice(stopTurnIndex + 1)
    .filter((turn) => turn.role === "coach");
  const closingTurns = coachTurnsAfterStop.filter((turn) => containsAny(turn.text, CLOSING_PATTERNS));
  const pass = closingTurns.length === 1;

  return gate("G5", pass, "scored", [
    `stopRefs=${stopEntries.map((entry) => entry.seq).join(",")}`,
    `closingTurnCount=${closingTurns.length}`,
    `closingTurnRefs=${closingTurns.flatMap((turn) => turn.seqRefs).join(",") || "none"}`,
  ], uniqueSeqs([firstStop, ...closingTurns.flatMap((turn) => turn.entries)]));
}

function gate(gateId, pass, status, evidence, seqRefs) {
  return {
    gate: gateId,
    pass: Boolean(pass),
    status,
    evidence,
    seqRefs,
  };
}

function preV3Gate(gateId, reason, refs) {
  return gate(gateId, false, "n/a, pre-v3", [
    "pre-v3 log: missing lessonMaterial*, intent hint, review count, and buffer/session-state telemetry.",
    reason,
  ], uniqueSeqs(refs));
}

function entriesAfterUntilNextUser(normalizedEntries, entry) {
  const start = normalizedEntries.indexOf(entry);
  if (start < 0) return [];
  const result = [];
  for (let index = start + 1; index < normalizedEntries.length; index += 1) {
    const candidate = normalizedEntries[index];
    if (candidate.role === "user") break;
    result.push(candidate);
  }
  return result;
}

function nextTurnAfterEntry(normalizedTurns, entry, role) {
  const turnIndex = turnIndexForEntry(normalizedTurns, entry);
  if (turnIndex < 0) return null;
  return normalizedTurns.slice(turnIndex + 1).find((turn) => turn.role === role) ?? null;
}

function turnIndexForEntry(normalizedTurns, entry) {
  return normalizedTurns.findIndex((turn) => turn.entries.includes(entry));
}

function containsAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(String(text ?? "")));
}

function isGarbled(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return true;
  if (/^[\s.,!?~…-]+$/.test(trimmed)) return true;
  if (containsAny(trimmed, GARBLED_PATTERNS)) return true;

  const chars = [...trimmed];
  const meaningful = chars.filter((char) => /[A-Za-z0-9가-힣]/.test(char)).length;
  const ratio = chars.length === 0 ? 0 : meaningful / chars.length;
  return chars.length >= 8 && ratio < 0.45;
}

function normalizeIntent(value) {
  const text = String(value ?? "").toLowerCase();
  if (!text) return "";
  if (/new|more|next|another|새|다음|더/.test(text)) return "new";
  if (/easy|easier|simple|쉬/.test(text)) return "easier";
  if (/hard|harder|difficult|어려/.test(text)) return "harder";
  return text;
}

function compareDifficulty(previous, next) {
  const previousRank = difficultyRank(previous);
  const nextRank = difficultyRank(next);
  if (!Number.isFinite(previousRank) || !Number.isFinite(nextRank) || previousRank === nextRank) return null;
  return nextRank < previousRank ? "easier" : "harder";
}

function difficultyRank(value) {
  if (value === undefined || value === null || value === "") return Number.NaN;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const text = String(value).toLowerCase();
  if (/beginner|easy|쉬/.test(text)) return 1;
  if (/intermediate|medium|normal|보통/.test(text)) return 2;
  if (/advanced|hard|difficult|어려/.test(text)) return 3;
  return Number.NaN;
}

function itemRepeatVerdict(data) {
  const key = data.lessonMaterialLastItemKey;
  if (!key) return { pass: undefined, evidence: "itemRepeat=unknown (last item key not logged)" };
  if (Array.isArray(data.seenItemKeysBefore)) {
    return {
      pass: !data.seenItemKeysBefore.includes(key),
      evidence: `itemRepeat=${data.seenItemKeysBefore.includes(key)} using seenItemKeysBefore`,
    };
  }
  if (Array.isArray(data.bufferedItemKeys) && data.bufferedItemKeys.includes(key)) {
    return {
      pass: true,
      evidence: "itemRepeat=false (last item came from bufferedItemKeys)",
    };
  }
  if (Array.isArray(data.seenItemKeys)) {
    return {
      pass: undefined,
      evidence: "itemRepeat=unknown (seenItemKeys is post-session state; seenItemKeysBefore missing)",
    };
  }
  return { pass: undefined, evidence: "itemRepeat=unknown (seen/buffer item keys not logged)" };
}

function pickValue(keys, ...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    }
  }
  return undefined;
}

function pickNumber(keys, ...sources) {
  const value = pickValue(keys, ...sources);
  const numeric = toNumber(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function pickArray(keys, ...sources) {
  const value = pickValue(keys, ...sources);
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return undefined;
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function numberOrZero(value) {
  const numeric = toNumber(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function includesString(values, needle) {
  return Array.isArray(values) && values.some((value) => String(value).includes(needle));
}

function uniqueSeqs(values) {
  return [...new Set(values.filter(Boolean).map((value) => value.seq ?? value))];
}
