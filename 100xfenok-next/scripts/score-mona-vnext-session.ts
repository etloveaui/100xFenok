import { readFileSync } from "node:fs";
import path from "node:path";
import { containsMonaVnextControlLeakage } from "../src/features/mona-vnext/logging/voiceLogSchema";
import { MONA_VNEXT_MAX_SAME_PROMPT } from "../src/features/mona-vnext/coach/coachPolicy";

type Check = {
  id: string;
  ok: boolean;
  detail: string;
};

type LogDoc = {
  source?: unknown;
  namespace?: unknown;
  tester?: unknown;
  startedAt?: unknown;
  stoppedAt?: unknown;
  finalized?: unknown;
  turns?: Array<Record<string, unknown>>;
  learnerTranscript?: Array<Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
};

function check(id: string, ok: boolean, detail: string): Check {
  return { id, ok, detail };
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getDurationSec(doc: LogDoc) {
  const start = Date.parse(getString(doc.startedAt));
  const stop = Date.parse(getString(doc.stoppedAt));
  if (!Number.isFinite(start) || !Number.isFinite(stop)) return null;
  return Math.round((stop - start) / 1000);
}

function countPromptIds(events: Array<Record<string, unknown>>) {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const event of events) {
    const detail = event.detail;
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) continue;
    const promptId = getString((detail as Record<string, unknown>).promptId);
    if (!promptId) continue;
    const turnSeq = (detail as Record<string, unknown>).turnSeq;
    const dedupeKey = typeof turnSeq === "number" && Number.isFinite(turnSeq)
      ? `${turnSeq}:${promptId}`
      : `${getString(event.atIso)}:${promptId}:${getString(event.message)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    counts.set(promptId, (counts.get(promptId) ?? 0) + 1);
  }
  return counts;
}

function nextIntentHonored(events: Array<Record<string, unknown>>) {
  return events
    .filter((event) => {
      const detail = event.detail;
      return detail
        && typeof detail === "object"
        && !Array.isArray(detail)
        && (detail as Record<string, unknown>).intent === "next_material";
    })
    .every((event) => {
      const detail = event.detail as Record<string, unknown>;
      return detail.materialChanged === true;
    });
}

function englishDisplayHonored(events: Array<Record<string, unknown>>) {
  return events
    .filter((event) => {
      const detail = event.detail;
      return detail
        && typeof detail === "object"
        && !Array.isArray(detail)
        && (detail as Record<string, unknown>).intent === "english_visibility";
    })
    .every((event) => getString(event.message).includes("english-visible") || getString(event.message).includes("keep-english"));
}

const fileArg = process.argv[2];
if (!fileArg) {
  console.error("Usage: tsx scripts/score-mona-vnext-session.ts data/voice-logs-vnext/owner-test/YYYY-MM-DD_mona-vnext_<conversationId>.json");
  process.exit(2);
}

const logPath = path.resolve(process.cwd(), fileArg);
const doc = JSON.parse(readFileSync(logPath, "utf8")) as LogDoc;
const turns = Array.isArray(doc.turns) ? doc.turns : [];
const transcript = Array.isArray(doc.learnerTranscript) ? doc.learnerTranscript : [];
const events = Array.isArray(doc.events) ? doc.events : [];
const durationSec = getDurationSec(doc);
const promptCounts = countPromptIds(events);
const maxPromptCount = Math.max(0, ...promptCounts.values());
const sttDriftCount = turns.filter((turn) => turn.sttDrift === true).length;
const controlLeakCount = transcript.filter((entry) => containsMonaVnextControlLeakage(getString(entry.text))).length;

const checks: Check[] = [
  check("namespace", doc.source === "mona-vnext" && doc.namespace === "voice-logs-vnext" && doc.tester === "owner", `${doc.source}/${doc.namespace}/${doc.tester}`),
  check("finalized", doc.finalized === true, `finalized=${doc.finalized === true}`),
  check("duration", durationSec !== null && durationSec >= 120, `durationSec=${durationSec ?? "unknown"}`),
  check("turn-count", turns.length >= 2, `turns=${turns.length}`),
  check("repeat-limit", maxPromptCount <= MONA_VNEXT_MAX_SAME_PROMPT, `maxPromptCount=${maxPromptCount}`),
  check("next-intent", nextIntentHonored(events), "next_material events require materialChanged=true"),
  check("english-display", englishDisplayHonored(events), "english_visibility events require visible-English repair"),
  check("control-leakage", controlLeakCount === 0, `controlLeakCount=${controlLeakCount}`),
  check("stt-drift-measured", turns.every((turn) => typeof turn.sttDrift === "boolean"), `sttDriftCount=${sttDriftCount}`),
];

for (const result of checks) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id} - ${result.detail}`);
}

const failed = checks.filter((item) => !item.ok);
if (failed.length > 0) {
  process.exitCode = 1;
}
