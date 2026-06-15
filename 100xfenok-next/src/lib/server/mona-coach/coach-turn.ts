// coachTurn — server-owned coaching brain wiring (CONTRACT 2026-06-14 section 2/5, Architecture A).
// Maps the persisted Mona StudySnapshot into the deterministic session-machine facade,
// keeps per-session coach state, and returns one authoritative TurnDirective per Mona utterance.
// No model calls here; the facade (session-machine.ts) is a pure function.

import {
  createMonaCoachState,
  runMonaCoachTurn,
  type MonaCoachItem,
  type MonaCoachSnapshot,
  type MonaCoachState,
  type MonaCoachToolCommand,
  type MonaCoachTurnDirective,
  type MonaLearnerIntent,
} from "@/lib/server/mona-coach/session-machine";
import {
  executeMonaStudyRepositoryTool,
  prepareMonaStudySnapshotFromRepository,
  type MonaStudyRepositoryContext,
} from "@/lib/server/mona-study-repository";
import { getMonaCornerForDate, getMonaLessonThemeForDate, type StudySnapshot } from "@/lib/server/mona-study-tools";
import type { LiveToolSessionContext } from "@/lib/server/admin-live-session-context";

const MAX_COACH_SESSIONS = 40;

type PendingSrs = {
  reviewResults: Array<{ en: string; result: "correct" | "wrong" }>;
  best3: Array<{ ko: string; en: string; alt?: string | null }>;
  weakMisses: Array<{ ko: string; tried: string; correct: string }>;
};

type CoachSessionEntry = {
  state: MonaCoachState;
  snapshot: MonaCoachSnapshot;
  pending: PendingSrs;
  updatedAt: number;
};

function emptyPending(): PendingSrs {
  return { reviewResults: [], best3: [], weakMisses: [] };
}

const coachSessions = new Map<string, CoachSessionEntry>();

function pruneCoachSessions() {
  if (coachSessions.size <= MAX_COACH_SESSIONS) return;
  const entries = [...coachSessions.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  for (const [key] of entries.slice(0, entries.length - MAX_COACH_SESSIONS)) {
    coachSessions.delete(key);
  }
}

function normalizeItemId(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textLength(value: unknown): number {
  return typeof value === "string" ? value.trim().length : 0;
}

function logCoachTurnArgs(args: Record<string, unknown>, sessionId: string) {
  console.info("[mona-coach] coachTurn args", {
    sessionId,
    attemptTextLen: textLength(args.attemptText),
    rawUtteranceLen: textLength(args.rawUtterance),
    hasIntent: typeof args.intent === "string" && args.intent.trim().length > 0,
  });
}

function isDue(due: string | null | undefined, studyDate: string): boolean {
  if (!due) return false;
  return due <= studyDate;
}

// G2 review-ratio: warmup is a few most-overdue items, not a flood (Mona curriculum: short warmup -> today).
const REVIEW_WARMUP_CAP = 3;
// G3 difficulty: Mona is at the "assemble sentences from known words" stage — keep new items short + easy.
const NEW_WORD_CAP = 8;

function sortByDueCap(candidates: Array<{ itemId: string; due: string }>, cap: number): string[] {
  return [...candidates]
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, cap)
    .map((candidate) => candidate.itemId);
}

// StudySnapshot (best3 + weak-notes + ppalmo bank) -> facade snapshot + SRS-priority queues.
// Priority order (SchedulePick, CONTRACT section 8): due weak -> due best3 -> curriculum focus -> new bank.
export function buildCoachSnapshot(study: StudySnapshot, excludeFromNew: Set<string> = new Set()): {
  snapshot: MonaCoachSnapshot;
  queues: MonaCoachState["queues"];
} {
  const studyDate = study.studyDate ?? "";
  const todayTheme = getMonaLessonThemeForDate(studyDate);
  // G3 weekday corner: Sunday (복습) is a review/test day — no new material, deeper review queue.
  const isReviewDay = todayTheme === null;
  const reviewCap = isReviewDay ? 10 : REVIEW_WARMUP_CAP;
  // G4 level-stage progression: 1-2 weeks = assembly stage (easy/short); 3+ weeks = expansion (allow a bit harder/longer).
  const stageWeeks = Math.floor((study.sessions?.length ?? 0) / 7);
  const maxDifficulty = stageWeeks >= 2 ? 3 : 2;
  const wordCap = stageWeeks >= 2 ? 10 : NEW_WORD_CAP;
  const itemsById = new Map<string, MonaCoachItem>();
  const ensure = (item: MonaCoachItem) => {
    if (!itemsById.has(item.itemId)) itemsById.set(item.itemId, item);
  };

  // G2: collect due review items, then keep only a small most-overdue warmup (no review flood).
  const dueWeakCandidates: Array<{ itemId: string; due: string }> = [];
  for (const weak of study.weakNotes ?? []) {
    const en = weak.correct;
    if (!en) continue;
    const itemId = normalizeItemId(en);
    ensure({
      itemId,
      ko: weak.ko ?? "",
      enCanonical: en,
      acceptedAlternatives: [],
      pattern: null,
      pronHint: null,
      difficulty: null,
      sibling: null,
      variations: [],
      source: "weak",
      srsBox: weak.box,
      due: weak.due ?? null,
    });
    if (isDue(weak.due, studyDate)) dueWeakCandidates.push({ itemId, due: weak.due ?? "" });
  }
  const dueWeak = sortByDueCap(dueWeakCandidates, reviewCap);

  const dueBest3Candidates: Array<{ itemId: string; due: string }> = [];
  for (const best of study.best3 ?? []) {
    const en = best.en;
    if (!en) continue;
    const itemId = normalizeItemId(en);
    ensure({
      itemId,
      ko: best.ko ?? "",
      enCanonical: en,
      acceptedAlternatives: best.acceptedAlternatives ?? [],
      pattern: null,
      pronHint: null,
      difficulty: null,
      sibling: null,
      variations: [],
      source: "best3",
      srsBox: best.box,
      due: best.due ?? null,
    });
    if (isDue(best.due, studyDate)) dueBest3Candidates.push({ itemId, due: best.due ?? "" });
  }
  const dueBest3 = sortByDueCap(dueBest3Candidates, reviewCap);

  // G1 (weekday theme, "free" always allowed) + G3 (difficulty/length gate for Mona's assembly stage):
  // only Mona-level-appropriate, on-theme new items reach the queue.
  const newBank: string[] = [];
  for (const entry of isReviewDay ? [] : (study.expressionBank ?? [])) {
    if (!entry?.en) continue;
    const itemId = normalizeItemId(entry.en);
    if (itemsById.has(itemId)) continue;
    if (excludeFromNew.has(itemId)) continue;
    if (todayTheme && entry.theme !== todayTheme && entry.theme !== "free") continue;
    if (entry.difficulty != null && entry.difficulty > maxDifficulty) continue;
    if (entry.wordCount != null && entry.wordCount > wordCap) continue;
    ensure({
      itemId,
      ko: entry.ko,
      enCanonical: entry.en,
      acceptedAlternatives: entry.sibling ? [entry.sibling.en] : [],
      pattern: entry.pattern ?? null,
      pronHint: null,
      difficulty: entry.difficulty ?? null,
      sibling: entry.sibling ?? null,
      variations: entry.variations ?? [],
      source: "bank",
    });
    newBank.push(itemId);
  }

  const focusText = normalizeItemId(study.curriculum?.nextFocus ?? "");
  const curriculumFocus = focusText
    ? [...itemsById.values()]
        .filter(
          (item) =>
            normalizeItemId(item.enCanonical).includes(focusText) ||
            normalizeItemId(item.ko).includes(focusText),
        )
        .map((item) => item.itemId)
    : [];

  return {
    snapshot: { version: study.loadedAt ?? studyDate, items: [...itemsById.values()] },
    queues: { dueWeak, dueBest3, curriculumFocus, newBank, sameDayBuffer: [] },
  };
}

const TOOL_INTENTS: MonaLearnerIntent[] = [
  "next_material",
  "easier",
  "harder",
  "switch_theme",
  "repeat_prompt",
  "repeat_target",
  "stop",
];

function normalizeCoachToolCommand(args: Record<string, unknown>): MonaCoachToolCommand | null {
  const intent = pickString(args.intent);
  if (intent && (TOOL_INTENTS as string[]).includes(intent)) {
    return { intent: intent as MonaLearnerIntent };
  }
  return null;
}

async function buildInitialCoachEntry(sessionId: string): Promise<CoachSessionEntry> {
  const { snapshot: study } = await prepareMonaStudySnapshotFromRepository();
  const fallbackDate = study?.studyDate ?? "";
  if (!study) {
    return {
      state: createMonaCoachState({ sessionId, studyDate: fallbackDate, snapshotVersion: "empty" }),
      snapshot: { version: "empty", items: [] },
      pending: emptyPending(),
      updatedAt: Date.now(),
    };
  }
  // Same-day re-entry: if a session already exists for today, this is a 2nd+ visit.
  // Skip items already passed earlier today so Mona is not re-dealt the identical cards.
  const todaySession = (study.sessions ?? []).find((session) => session.date === study.studyDate);
  const passedToday = new Set(
    (todaySession?.best3 ?? [])
      .map((item) => (item?.en ? normalizeItemId(item.en) : ""))
      .filter(Boolean),
  );
  const sessionOrdinalToday = todaySession ? 2 : 1;
  // G3 corner: Friday (프리토킹) runs a 1-minute free-talk monologue instead of the drill loop.
  const sessionMode = getMonaCornerForDate(study.studyDate ?? fallbackDate) === "프리토킹" ? "freetalk" : "lesson";
  const { snapshot, queues } = buildCoachSnapshot(study, passedToday);
  return {
    state: createMonaCoachState({
      sessionId,
      studyDate: study.studyDate ?? fallbackDate,
      snapshotVersion: snapshot.version,
      sessionOrdinalToday,
      sessionMode,
      queues,
    }),
    snapshot,
    pending: emptyPending(),
    updatedAt: Date.now(),
  };
}

export type CoachTurnResult = {
  cardCommand: MonaCoachTurnDirective["cardCommand"];
  spokenGuidance: string;
  mayPraise: boolean;
  nextExpectedState: MonaCoachTurnDirective["nextExpectedState"];
  intent: MonaLearnerIntent;
  verdict: string | null;
  itemId: string | null;
};

function accumulatePendingSrs(pending: PendingSrs, directive: MonaCoachTurnDirective) {
  const delta = directive.saveReviewDelta;
  if (delta.type !== "attempt") return;
  const item = directive.state.current;
  if (!item) return;
  if (delta.verdict !== "correct" && delta.verdict !== "wrong") return;
  pending.reviewResults.push({ en: item.enCanonical, result: delta.verdict });
  if (delta.verdict === "correct") {
    pending.best3.push({ ko: item.ko, en: item.enCanonical, alt: delta.matchedAlternative ?? null });
  } else {
    pending.weakMisses.push({ ko: item.ko, tried: delta.learnerText ?? "", correct: item.enCanonical });
  }
}

function dedupeBest3(items: Array<{ ko: string; en: string; alt?: string | null }>): Array<{ ko: string; en: string; alt?: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ ko: string; en: string; alt?: string | null }> = [];
  for (const item of [...items].reverse()) {
    const key = item.en.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.reverse();
}

// Persist accumulated attempts into the existing Leitner SRS (best3 / weak-notes box+due) via saveStudySession.
// Owner-test isolation is preserved through the context tester flag. Best-effort: never breaks the live turn.
async function commitPendingSrs(pending: PendingSrs, context?: LiveToolSessionContext | null) {
  if (context?.noPersist) return;
  if (!pending.reviewResults.length && !pending.best3.length && !pending.weakMisses.length) return;
  const repoContext: MonaStudyRepositoryContext = {
    sessionId: context?.sessionId ?? undefined,
    mode: context?.mode,
    coachConfig: context?.coachConfig as unknown as Record<string, unknown> | undefined,
    coachSessionState: context?.coachSessionState ?? undefined,
    tester: (context?.coachConfig as { tester?: unknown } | undefined)?.tester,
    noPersist: context?.noPersist,
  };
  try {
    await executeMonaStudyRepositoryTool(
      "saveStudySession",
      {
        reviewResults: pending.reviewResults,
        best3: dedupeBest3(pending.best3).slice(-3).map((entry) => ({ ko: entry.ko, en: entry.en, acceptedAlternatives: entry.alt ? [entry.alt] : [] })),
        weakMisses: pending.weakMisses,
      },
      repoContext,
    );
  } catch {
    // best-effort: SRS persistence failure must not break the live turn.
  }
}

// Live-tool entry point. The model is instructed to call coachTurn({attemptText}) every Mona utterance
// and obey the returned directive (speak spokenGuidance, render cardCommand, praise only if mayPraise).
export async function executeCoachTurn(
  args: Record<string, unknown>,
  context?: LiveToolSessionContext | null,
): Promise<CoachTurnResult> {
  // B-B: key the coach FSM by the STABLE coachSessionKey (logSessionId/conversationId) so the brain
  // survives a provider resume (provider sessionId changes on resume; coachSessionKey does not).
  const sessionId = pickString(context?.coachSessionKey ?? null)
    ?? pickString(context?.sessionId ?? null)
    ?? "anon";
  logCoachTurnArgs(args, sessionId);
  const learnerTranscript = pickString(args.attemptText) ?? pickString(args.rawUtterance) ?? "";
  const toolCmd = normalizeCoachToolCommand(args);

  const entry = coachSessions.get(sessionId) ?? (await buildInitialCoachEntry(sessionId));
  const prevItemId = entry.state.current?.itemId ?? null;

  const directive = runMonaCoachTurn({
    snapshot: entry.snapshot,
    state: entry.state,
    learnerTranscript,
    toolCmd,
  });

  accumulatePendingSrs(entry.pending, directive);
  // G5 no-stop persistence: commit when an item is finished (card moves on) OR on explicit stop,
  // so a session that ends without "그만" still saves its attempts to the SRS instead of losing them.
  const currentItemId = directive.state.current?.itemId ?? null;
  const itemFinished = prevItemId !== null && currentItemId !== prevItemId;
  if (directive.intent === "stop" || itemFinished) {
    await commitPendingSrs(entry.pending, context);
    entry.pending = emptyPending();
  }

  coachSessions.set(sessionId, {
    state: directive.state,
    snapshot: entry.snapshot,
    pending: entry.pending,
    updatedAt: Date.now(),
  });
  pruneCoachSessions();

  return {
    cardCommand: directive.cardCommand,
    spokenGuidance: directive.spokenGuidance,
    mayPraise: directive.mayPraise,
    nextExpectedState: directive.nextExpectedState,
    intent: directive.intent,
    verdict: directive.attemptEval?.verdict ?? null,
    itemId: directive.state.current?.itemId ?? null,
  };
}

// test seam: clear the in-memory per-session store.
export function __resetCoachSessionsForTest() {
  coachSessions.clear();
}

// test seam: inject a per-session entry so executeCoachTurn skips the repository/disk load.
export function __seedCoachSessionForTest(sessionId: string, state: MonaCoachState, snapshot: MonaCoachSnapshot) {
  coachSessions.set(sessionId, { state, snapshot, pending: emptyPending(), updatedAt: 0 });
}
