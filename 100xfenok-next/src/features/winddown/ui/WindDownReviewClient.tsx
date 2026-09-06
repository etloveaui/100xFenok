"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyWindDownReviewAction,
  createWindDownReviewChipExercise,
  createWindDownReviewSession,
  joinWindDownReviewChips,
  type WindDownReviewCard,
  type WindDownReviewChipExercise,
  type WindDownReviewCommitInput,
  type WindDownReviewInputMode,
  type WindDownReviewState,
} from "@/features/winddown/review/engine";
import {
  archiveWindDownReviewDraft,
  clearWindDownReviewDraftAfterExport,
  createWindDownReviewDraft,
  loadWindDownReviewDraft,
  loadWindDownReviewDraftRecovery,
  saveWindDownReviewDraft,
  type WindDownReviewDraftStorage,
} from "@/features/winddown/review/draft";
import {
  WindDownLumi,
  type WindDownLumiState,
} from "@/features/winddown/ui/WindDownLumi";
import {
  WIND_DOWN_IDLE_ASSIST_DELAY_MS,
  firstEnglishLetter,
} from "@/features/winddown/ui/windDownAssistiveHints";
import {
  WindDownDeviceSpeechPractice,
} from "@/features/winddown/speech/WindDownDeviceSpeechPractice";

type StudyResponse = {
  schemaVersion: 1;
  mode: "review";
  modelOpened: false;
  cards: WindDownReviewCard[];
  material: {
    source: "published-lkg";
    publicationStatus: "active";
    contentDigest: string;
  };
};

const SHA256_HEX = /^[a-f0-9]{64}$/;

type ReviewApiErrorCode =
  | "REVIEW_CYCLE_STALE"
  | "REVIEW_CYCLE_NOT_DUE"
  | "REVIEW_CYCLE_CONFLICT"
  | "MATERIAL_VERSION_CHANGED"
  | "MATERIAL_NOT_ACTIVE"
  | "INVALID_REVIEW_CYCLE"
  | "REVIEW_API_FAILED";

type ReviewReceipt = {
  reviewCycleId: string;
  materialId: string;
  rating: "good" | "hard" | "again";
  reward: 0 | 1;
  inputMode: WindDownReviewInputMode;
};

class ReviewApiError extends Error {
  constructor(readonly code: ReviewApiErrorCode) {
    super(code);
    this.name = "ReviewApiError";
  }
}

const RELOAD_QUEUE_CODES = new Set<ReviewApiErrorCode>([
  "REVIEW_CYCLE_STALE",
  "REVIEW_CYCLE_NOT_DUE",
  "REVIEW_CYCLE_CONFLICT",
  "MATERIAL_VERSION_CHANGED",
  "MATERIAL_NOT_ACTIVE",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isReviewCard(value: unknown): value is WindDownReviewCard {
  const card = asRecord(value);
  return Boolean(
    card &&
      typeof card.id === "string" &&
      typeof card.ko === "string" &&
      typeof card.en === "string" &&
      typeof card.reviewCycleId === "string" &&
      card.reviewCycleId.startsWith("winddown-review:") &&
      typeof card.dueAtIso === "string" &&
      Number.isFinite(Date.parse(card.dueAtIso)),
  );
}

function isStudyResponse(value: unknown): value is StudyResponse {
  const source = asRecord(value);
  const material = asRecord(source?.material);
  return Boolean(
    source?.schemaVersion === 1 &&
      source.mode === "review" &&
      source.modelOpened === false &&
      Array.isArray(source.cards) &&
      source.cards.every(isReviewCard) &&
      material?.source === "published-lkg" &&
      material.publicationStatus === "active" &&
      typeof material.contentDigest === "string" &&
      SHA256_HEX.test(material.contentDigest),
  );
}

function errorCode(value: unknown): ReviewApiErrorCode {
  const source = asRecord(value);
  const nested = asRecord(source?.error);
  const candidate =
    typeof source?.error === "string"
      ? source.error
      : typeof source?.code === "string"
        ? source.code
        : typeof nested?.code === "string"
          ? nested.code
          : "REVIEW_API_FAILED";
  return [
    "REVIEW_CYCLE_STALE",
    "REVIEW_CYCLE_NOT_DUE",
    "REVIEW_CYCLE_CONFLICT",
    "MATERIAL_VERSION_CHANGED",
    "MATERIAL_NOT_ACTIVE",
    "INVALID_REVIEW_CYCLE",
  ].includes(candidate)
    ? (candidate as ReviewApiErrorCode)
    : "REVIEW_API_FAILED";
}

function gradeIsExact(value: unknown): boolean | null {
  const source = asRecord(value);
  const grade = asRecord(source?.grade) ?? source;
  for (const candidate of [grade?.exact, grade?.matched, grade?.correct]) {
    if (typeof candidate === "boolean") return candidate;
  }
  const label =
    typeof source?.outcome === "string"
      ? source.outcome
      : typeof source?.grade === "string"
        ? source.grade
        : typeof grade?.rating === "string"
      ? grade.rating
      : typeof grade?.verdict === "string"
        ? grade.verdict
        : typeof grade?.outcome === "string"
          ? grade.outcome
          : null;
  if (
    ["correct", "good", "hard", "canonical", "variant", "exact", "pass"].includes(
      label ?? "",
    )
  ) {
    return true;
  }
  if (["again", "miss", "incorrect", "fail"].includes(label ?? "")) {
    return false;
  }
  return null;
}

function receiptFrom(value: unknown): ReviewReceipt | null {
  const source = asRecord(value);
  const result = asRecord(source?.result);
  const receipt = asRecord(source?.receipt) ?? asRecord(result?.receipt);
  if (
    !receipt ||
    typeof receipt.reviewCycleId !== "string" ||
    typeof receipt.materialId !== "string" ||
    !["good", "hard", "again"].includes(String(receipt.rating)) ||
    (receipt.inputMode !== undefined &&
      !["chips", "typed"].includes(String(receipt.inputMode))) ||
    (receipt.reward !== 0 && receipt.reward !== 1)
  ) {
    return null;
  }
  return {
    ...(receipt as Omit<ReviewReceipt, "inputMode">),
    inputMode: receipt.inputMode === "chips" ? "chips" : "typed",
  };
}

async function postReviewOperation(body: Record<string, unknown>) {
  const response = await fetch("/api/winddown/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ReviewApiError(errorCode(payload));
  return payload;
}

function isBusy(state: WindDownReviewState | null) {
  return (
    state?.phase === "grading-first" ||
    state?.phase === "grading-retry" ||
    state?.phase === "committing"
  );
}

function queueProgress(state: WindDownReviewState | null, initialCount: number) {
  if (!state || initialCount === 0) return 0;
  return Math.round((state.results.length / initialCount) * 100);
}

function getWindDownReviewDraftStorage(): WindDownReviewDraftStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function downloadWindDownReviewRaw(raw: string) {
  const url = URL.createObjectURL(
    new Blob([raw], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "winddown-review-draft-recovery.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function ReviewChipInput({
  exercise,
  selectedIds,
  onChange,
  disabled,
  assistVisible,
  accent = "var(--wd-accent)",
}: {
  exercise: WindDownReviewChipExercise;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  assistVisible: boolean;
  accent?: string;
}) {
  const byId = new Map(exercise.chips.map((chip) => [chip.id, chip]));
  const selected = selectedIds.flatMap((id) => {
    const chip = byId.get(id);
    return chip ? [chip] : [];
  });
  return (
    <>
      <div
        aria-label="선택한 단어"
        className="mt-4 flex min-h-16 flex-wrap content-start gap-2 rounded-2xl border border-dashed border-[var(--wd-border)] bg-[var(--wd-bg)] p-3"
      >
        {selected.length === 0 ? (
          <span className="text-sm font-semibold text-[var(--wd-text-muted)]">
            아래 단어를 순서대로 눌러봐
          </span>
        ) : null}
        {selected.map((chip) => (
          <button
            key={chip.id}
            type="button"
            disabled={disabled}
            aria-pressed="true"
            aria-label={`${chip.text} 선택됨 · 눌러서 제거`}
            onClick={() => onChange(selectedIds.filter((id) => id !== chip.id))}
            className="min-h-[44px] min-w-[44px] max-w-full break-words rounded-xl px-3 text-sm font-black text-[var(--wd-bg)] disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            {chip.text}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="고를 단어">
        {exercise.chips.map((chip) => {
          const isSelected = selectedIds.includes(chip.id);
          const isFirst =
            assistVisible && chip.id === exercise.canonicalChipIds[0];
          return (
            <button
              key={chip.id}
              type="button"
              disabled={disabled || isSelected}
              aria-pressed={isSelected}
              onClick={() => onChange([...selectedIds, chip.id])}
              className={[
                "min-h-[44px] min-w-[44px] max-w-full break-words rounded-xl border border-[var(--wd-border)] bg-[var(--wd-surface-raised)] px-3 text-sm font-black disabled:opacity-25",
                isFirst
                  ? "ring-2 ring-[var(--wd-listening)]"
                  : "",
              ].join(" ")}
            >
              {chip.text}
            </button>
          );
        })}
      </div>
    </>
  );
}

export default function WindDownReviewClient() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [session, setSession] = useState<WindDownReviewState | null>(null);
  const [initialCount, setInitialCount] = useState(0);
  const [answer, setAnswer] = useState("");
  const [selectedChipIds, setSelectedChipIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftRecoveryNotice, setDraftRecoveryNotice] = useState<string | null>(null);
  const [draftRecoveryAvailable, setDraftRecoveryAvailable] = useState(false);
  const [draftRecoveryActionAvailable, setDraftRecoveryActionAvailable] = useState(false);
  const [draftExportAcknowledgmentAvailable, setDraftExportAcknowledgmentAvailable] = useState(false);
  const [draftStorageNotice, setDraftStorageNotice] = useState<string | null>(null);
  const [recallAssistVisible, setRecallAssistVisible] = useState(false);
  const loadSequence = useRef(0);
  const typedInput = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<WindDownReviewState | null>(null);
  const answerRef = useRef("");
  const selectedChipIdsRef = useRef<string[]>([]);
  const allCardsRef = useRef<WindDownReviewCard[]>([]);
  const draftStorageRef = useRef<WindDownReviewDraftStorage | null>(null);
  const draftWritesAllowedRef = useRef(true);
  const draftRecoveryRawRef = useRef<string | null>(null);
  const draftExportedRawRef = useRef<string | null>(null);

  const setReviewSession = useCallback((next: WindDownReviewState | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const setReviewAnswer = useCallback((next: string) => {
    answerRef.current = next;
    setAnswer(next);
  }, []);

  const setReviewChipIds = useCallback((next: string[]) => {
    selectedChipIdsRef.current = next;
    setSelectedChipIds(next);
  }, []);

  const persistDraft = useCallback(
    (
      nextState: WindDownReviewState,
      nextAnswer = answerRef.current,
      nextSelectedChipIds = selectedChipIdsRef.current,
    ): boolean => {
      if (!draftWritesAllowedRef.current) return false;
      const storage = draftStorageRef.current;
      if (!storage) {
        setDraftStorageNotice(
          "기기 저장공간을 사용할 수 없어. 복습은 계속할 수 있지만 같은 화면 복구가 제한돼.",
        );
        return false;
      }
      try {
        const draft = createWindDownReviewDraft({
          state: nextState,
          cards: allCardsRef.current,
          answer: nextAnswer,
          selectedChipIds: nextSelectedChipIds,
        });
        const saved = saveWindDownReviewDraft(storage, draft);
        if (saved.status !== "saved") {
          setDraftStorageNotice(
            "복습은 계속할 수 있어. 기기 저장공간이 가득 차서 이어하기 기록은 남기지 못했어.",
          );
          return false;
        }
        return true;
      } catch {
        setDraftStorageNotice(
          "복습은 계속할 수 있어. 이어하기 기록을 기기 저장공간에 남기지 못했어.",
        );
        return false;
      }
    },
    [],
  );

  const loadQueue = useCallback(async (reloadNotice: string | null = null) => {
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    setStatus("loading");
    setReviewSession(null);
    setReviewAnswer("");
    setReviewChipIds([]);
    setNotice(reloadNotice);
    setDraftRecoveryNotice(null);
    setDraftRecoveryAvailable(false);
    setDraftRecoveryActionAvailable(false);
    setDraftExportAcknowledgmentAvailable(false);
    setDraftStorageNotice(null);
    draftStorageRef.current = getWindDownReviewDraftStorage();
    draftWritesAllowedRef.current = true;
    draftRecoveryRawRef.current = null;
    draftExportedRawRef.current = null;
    try {
      const response = await fetch("/api/winddown/study?mode=review", {
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (!response.ok || !isStudyResponse(body)) {
        throw new Error("winddown_review_bootstrap_invalid");
      }
      if (loadSequence.current !== sequence) return;
      const freshState = createWindDownReviewSession({
        cards: body.cards,
        contentDigest: body.material.contentDigest,
      });
      const loaded = loadWindDownReviewDraft({
        storage: draftStorageRef.current,
        cards: body.cards,
        contentDigest: body.material.contentDigest,
        nowIso: new Date().toISOString(),
      });
      const recovery = loadWindDownReviewDraftRecovery(draftStorageRef.current);
      setDraftRecoveryAvailable(recovery.status === "available");
      if (loaded.status === "resumed") {
        allCardsRef.current = loaded.draft.cards;
        setInitialCount(loaded.draft.cards.length);
        setReviewSession(loaded.state);
        setReviewAnswer(loaded.answer);
        setReviewChipIds(loaded.selectedChipIds);
        setNotice(
          reloadNotice ??
            (loaded.reconciled
              ? "복습 대기열이 바뀌어도 이어갈 수 있게 기록을 맞췄어."
              : "이전 복습 화면에서 이어갈게."),
        );
        if (recovery.status === "available") {
          setDraftRecoveryNotice("이전 복습 보관본을 내려받을 수 있어.");
        }
      } else {
        allCardsRef.current = body.cards;
        setInitialCount(body.cards.length);
        setReviewSession(freshState);
        setReviewAnswer("");
        setReviewChipIds([]);
        if (loaded.status === "stale" || loaded.status === "malformed") {
          draftWritesAllowedRef.current = false;
          draftRecoveryRawRef.current = loaded.raw;
          draftExportedRawRef.current = null;
          setDraftRecoveryAvailable(true);
          setDraftRecoveryActionAvailable(true);
          setDraftRecoveryNotice(
            "이전 복습 기록을 이어갈 수 없어 새 대기열을 열었어. 보관한 뒤 현재 복습을 이어갈 수 있어.",
          );
        } else if (loaded.status === "unavailable") {
          setDraftRecoveryNotice(
            "기기 저장공간을 사용할 수 없어. 복습은 계속할 수 있지만 같은 화면 복구가 제한돼.",
          );
        } else if (recovery.status === "available") {
          setDraftRecoveryNotice("이전 복습 보관본을 내려받을 수 있어.");
        }
      }
      setStatus("ready");
    } catch {
      if (loadSequence.current !== sequence) return;
      setStatus("error");
    }
  }, [setReviewAnswer, setReviewChipIds, setReviewSession]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const reloadForCycleChange = useCallback(() => {
    void loadQueue("복습 순서가 바뀌어서 오늘의 대기열을 새로 불렀어.");
  }, [loadQueue]);

  const archiveRejectedDraftAndContinue = useCallback(() => {
    const storage = draftStorageRef.current;
    const archived = archiveWindDownReviewDraft(storage);
    if (archived.status !== "archived") {
      setDraftRecoveryNotice(
        archived.status === "missing"
          ? "보관할 이전 기록을 찾지 못했어. 현재 복습은 계속할 수 있어."
          : "이전 기록을 보관하지 못했어. 원본은 그대로 남아 있으니 다시 시도해.",
      );
      return;
    }
    draftRecoveryRawRef.current = null;
    draftExportedRawRef.current = null;
    setDraftRecoveryAvailable(true);
    setDraftRecoveryActionAvailable(false);
    setDraftExportAcknowledgmentAvailable(false);
    const currentSession = sessionRef.current;
    if (!currentSession) {
      draftWritesAllowedRef.current = false;
      setDraftRecoveryNotice(
        "이전 기록은 보관했지만 현재 복습 화면을 찾지 못했어. 새로 불러오면 이어갈 수 있어.",
      );
      return;
    }
    draftWritesAllowedRef.current = true;
    const saved = persistDraft(
      currentSession,
      answerRef.current,
      selectedChipIdsRef.current,
    );
    if (!saved) {
      draftWritesAllowedRef.current = false;
      setDraftRecoveryNotice(
        "이전 기록은 보관했지만 새 이어하기 기록을 저장하지 못했어. 복습은 계속할 수 있어.",
      );
      return;
    }
    setDraftRecoveryNotice(
      "이전 기록을 보관했어. 현재 복습을 새 이어하기 기록으로 저장했어.",
    );
  }, [persistDraft]);

  const clearExportedDraftAndContinue = useCallback(() => {
    const exportedRaw = draftExportedRawRef.current;
    if (exportedRaw === null) {
      setDraftRecoveryNotice(
        "먼저 이전 기록을 내려받아 파일을 보관했는지 확인해 줘.",
      );
      return;
    }
    const cleared = clearWindDownReviewDraftAfterExport(
      draftStorageRef.current,
      exportedRaw,
    );
    if (cleared.status === "unavailable") {
      if (cleared.reason === "export-mismatch" && cleared.currentRaw !== undefined) {
        draftRecoveryRawRef.current = cleared.currentRaw;
        draftExportedRawRef.current = null;
        setDraftExportAcknowledgmentAvailable(false);
        setDraftRecoveryActionAvailable(true);
        setDraftRecoveryAvailable(true);
        setDraftRecoveryNotice(
          "활성 기록이 바뀌어서 새 기록으로 바꾸지 않았어. 현재 기록을 다시 내려받은 뒤 확인해 줘.",
        );
      } else {
        setDraftRecoveryNotice(
          "저장 상태를 확인하지 못했어. 내려받은 파일을 보관하고 다시 시도해.",
        );
      }
      return;
    }
    const currentSession = sessionRef.current;
    if (!currentSession) {
      draftWritesAllowedRef.current = false;
      setDraftExportAcknowledgmentAvailable(false);
      setDraftRecoveryActionAvailable(false);
      setDraftRecoveryNotice(
        "이전 기록은 확인했지만 현재 복습 화면을 찾지 못했어. 새로 불러오면 이어갈 수 있어.",
      );
      return;
    }
    draftWritesAllowedRef.current = true;
    const saved = persistDraft(
      currentSession,
      answerRef.current,
      selectedChipIdsRef.current,
    );
    if (!saved) {
      draftWritesAllowedRef.current = false;
      setDraftExportAcknowledgmentAvailable(false);
      setDraftRecoveryActionAvailable(false);
      setDraftRecoveryNotice(
        "이전 기록은 확인했지만 새 이어하기 기록을 저장하지 못했어. 복습은 계속할 수 있어.",
      );
      return;
    }
    draftExportedRawRef.current = null;
    draftRecoveryRawRef.current = null;
    setDraftExportAcknowledgmentAvailable(false);
    setDraftRecoveryActionAvailable(false);
    const recovery = loadWindDownReviewDraftRecovery(draftStorageRef.current);
    setDraftRecoveryAvailable(recovery.status === "available");
    setDraftRecoveryNotice(
      cleared.status === "missing"
        ? "이전 기록은 이미 비워져 있었어. 현재 복습을 새 이어하기 기록으로 저장했어."
        : "파일을 보관했어. 현재 복습을 새 이어하기 기록으로 저장했어.",
    );
  }, [persistDraft]);

  const downloadDraftRecovery = useCallback(() => {
    const rawFromActive = draftRecoveryRawRef.current;
    const recovery = rawFromActive !== null
      ? { status: "available" as const, raw: rawFromActive }
      : loadWindDownReviewDraftRecovery(draftStorageRef.current);
    if (recovery.status !== "available") {
      setDraftRecoveryNotice(
        recovery.status === "missing"
          ? "내려받을 보관 기록이 없어. 먼저 이전 기록을 보관해 줘."
          : "보관 기록을 읽지 못했어. 복습은 계속할 수 있어.",
      );
      return;
    }
    try {
      downloadWindDownReviewRaw(recovery.raw);
    } catch {
      setDraftRecoveryNotice(
        "파일 내려받기를 시작하지 못했어. 원본은 그대로 남아 있어.",
      );
      return;
    }
    if (rawFromActive !== null) {
      draftExportedRawRef.current = rawFromActive;
      setDraftExportAcknowledgmentAvailable(true);
      setDraftRecoveryNotice(
        "파일 내려받기를 시작했어. 파일을 보관했다면 아래에서 새 기록으로 이어가.",
      );
    } else {
      setDraftRecoveryNotice("이전 복습 보관본 내려받기를 시작했어.");
    }
  }, []);

  const commit = useCallback(
    async (committingState: WindDownReviewState) => {
      const input = committingState.commitInput;
      if (!input) return;
      try {
        const body = await postReviewOperation({
          operation: "commit-review-cycle",
          ...input,
        });
        const receipt = receiptFrom(body);
        if (
          !receipt ||
          receipt.reviewCycleId !== input.reviewCycleId ||
          receipt.materialId !== input.materialId ||
          receipt.inputMode !== input.inputMode
        ) {
          throw new ReviewApiError("REVIEW_API_FAILED");
        }
        const next = applyWindDownReviewAction(committingState, {
          type: "commit-succeeded",
          result: {
            materialId: receipt.materialId,
            reviewCycleId: receipt.reviewCycleId,
            rating: receipt.rating,
            reward: receipt.reward,
          },
        });
        if (next.outcome === "invalid") throw new ReviewApiError("REVIEW_API_FAILED");
        setReviewSession(next.state);
        setReviewAnswer("");
        setReviewChipIds([]);
        persistDraft(next.state, "", []);
        setNotice(
          receipt.rating === "good"
            ? "좋아. 정확히 기억했어."
            : receipt.rating === "hard"
              ? "다시 잡아냈어. 다음 간격을 짧게 둘게."
              : "정답을 확인했어. 다음에 다시 만나자.",
        );
      } catch (error) {
        if (error instanceof ReviewApiError && RELOAD_QUEUE_CODES.has(error.code)) {
          reloadForCycleChange();
          return;
        }
        const failed = applyWindDownReviewAction(committingState, {
          type: "commit-failed",
        });
        if (failed.outcome !== "invalid") {
          setReviewSession(failed.state);
          persistDraft(failed.state);
        }
      }
    },
    [persistDraft, reloadForCycleChange, setReviewAnswer, setReviewChipIds, setReviewSession],
  );

  const grade = useCallback(
    async (gradingState: WindDownReviewState, stage: "first" | "retry") => {
      const card = gradingState.queue[0];
      const pendingAnswer = gradingState.pendingAnswer;
      if (!card || !pendingAnswer) return;
      const attempts = [
        ...gradingState.attempts,
        { answer: pendingAnswer, revealedBefore: false },
      ];
      const input: WindDownReviewCommitInput = {
        schemaVersion: 1,
        activity: "review",
        reviewCycleId: card.reviewCycleId,
        materialId: card.id,
        contentDigest: gradingState.contentDigest,
        inputMode: gradingState.inputMode,
        attempts,
      };
      try {
        const body = await postReviewOperation({
          operation: "grade-recall",
          schemaVersion: input.schemaVersion,
          activity: input.activity,
          reviewCycleId: input.reviewCycleId,
          materialId: input.materialId,
          contentDigest: input.contentDigest,
          inputMode: input.inputMode,
          attempt: attempts.at(-1),
        });
        const exact = gradeIsExact(body);
        if (exact === null) throw new ReviewApiError("REVIEW_API_FAILED");
        const next = applyWindDownReviewAction(gradingState,
          stage === "first"
            ? { type: "first-graded", exact }
            : { type: "retry-graded", exact },
        );
        if (next.outcome === "invalid") throw new ReviewApiError("REVIEW_API_FAILED");
        const shouldClearAnswer =
          next.state.phase === "match" || next.state.phase === "committing";
        const nextAnswer = shouldClearAnswer ? "" : answerRef.current;
        const nextSelectedChipIds = shouldClearAnswer
          ? []
          : selectedChipIdsRef.current;
        setReviewSession(next.state);
        if (shouldClearAnswer) {
          setReviewAnswer("");
          setReviewChipIds([]);
        }
        persistDraft(next.state, nextAnswer, nextSelectedChipIds);
        if (next.state.phase === "committing") void commit(next.state);
      } catch (error) {
        if (error instanceof ReviewApiError && RELOAD_QUEUE_CODES.has(error.code)) {
          reloadForCycleChange();
          return;
        }
        const failed = applyWindDownReviewAction(gradingState,
          stage === "first"
            ? { type: "first-grade-failed" }
            : { type: "retry-grade-failed" },
        );
        if (failed.outcome !== "invalid") {
          setReviewSession(failed.state);
          persistDraft(failed.state);
        }
      }
    },
    [
      commit,
      persistDraft,
      reloadForCycleChange,
      setReviewAnswer,
      setReviewChipIds,
      setReviewSession,
    ],
  );

  const submitFirst = (submittedAnswer: string) => {
    if (!session || isBusy(session)) return;
    const next = applyWindDownReviewAction(session, {
      type: "submit-first",
      answer: submittedAnswer,
    });
    if (next.outcome === "invalid") return;
    setReviewSession(next.state);
    setNotice(null);
    persistDraft(next.state, submittedAnswer, selectedChipIdsRef.current);
    void grade(next.state, "first");
  };

  const reveal = () => {
    if (!session || isBusy(session)) return;
    const next = applyWindDownReviewAction(session, { type: "reveal" });
    if (next.outcome === "invalid") return;
    setReviewSession(next.state);
    setReviewAnswer("");
    setReviewChipIds([]);
    setNotice(null);
    persistDraft(next.state, "", []);
    void commit(next.state);
  };

  const submitRetry = (submittedAnswer: string) => {
    if (!session || isBusy(session)) return;
    const next = applyWindDownReviewAction(session, {
      type: "submit-retry",
      answer: submittedAnswer,
    });
    if (next.outcome === "invalid") return;
    setReviewSession(next.state);
    setNotice(null);
    persistDraft(next.state, submittedAnswer, selectedChipIdsRef.current);
    void grade(next.state, "retry");
  };

  const retryGrade = (stage: "first" | "retry") => {
    if (!session || isBusy(session)) return;
    const next = applyWindDownReviewAction(session,
      stage === "first"
        ? { type: "retry-first-grade" }
        : { type: "retry-retry-grade" },
    );
    if (next.outcome === "invalid") return;
    setReviewSession(next.state);
    persistDraft(next.state);
    void grade(next.state, stage);
  };

  const retryCommit = () => {
    if (!session || isBusy(session)) return;
    const next = applyWindDownReviewAction(session, { type: "retry-commit" });
    if (next.outcome === "invalid") return;
    setReviewSession(next.state);
    persistDraft(next.state);
    void commit(next.state);
  };

  const selectMatchTile = (tileId: string) => {
    if (!session || isBusy(session)) return;
    const next = applyWindDownReviewAction(session, {
      type: "select-match-tile",
      tileId,
    });
    if (next.outcome === "invalid") return;
    setReviewSession(next.state);
    persistDraft(next.state);
  };

  const updateAnswer = (nextAnswer: string) => {
    setReviewAnswer(nextAnswer);
    const currentSession = sessionRef.current;
    if (currentSession && !isBusy(currentSession)) {
      persistDraft(currentSession, nextAnswer, selectedChipIdsRef.current);
    }
  };

  const updateSelectedChipIds = (nextSelectedChipIds: string[]) => {
    setReviewChipIds(nextSelectedChipIds);
    const currentSession = sessionRef.current;
    if (currentSession && !isBusy(currentSession)) {
      persistDraft(currentSession, answerRef.current, nextSelectedChipIds);
    }
  };

  const busy = isBusy(session);
  const current = session?.queue[0] ?? null;
  const chipExercise = useMemo(
    () => (current ? createWindDownReviewChipExercise(current) : null),
    [current],
  );
  const selectedChips = useMemo(() => {
    if (!chipExercise) return [];
    const byId = new Map(chipExercise.chips.map((chip) => [chip.id, chip]));
    return selectedChipIds.flatMap((id) => {
      const chip = byId.get(id);
      return chip ? [chip] : [];
    });
  }, [chipExercise, selectedChipIds]);
  const selectedChipAnswer = useMemo(
    () => joinWindDownReviewChips(selectedChips),
    [selectedChips],
  );
  const submittedAnswer =
    session?.inputMode === "typed" ? answer : selectedChipAnswer;

  const setInputMode = (inputMode: WindDownReviewInputMode) => {
    if (!session || isBusy(session)) return;
    const next = applyWindDownReviewAction(session, {
      type: "set-input-mode",
      inputMode,
    });
    if (next.outcome === "invalid") return;
    setReviewSession(next.state);
    setReviewAnswer("");
    setReviewChipIds([]);
    setNotice(null);
    persistDraft(next.state, "", []);
  };

  useEffect(() => {
    const onPageHide = () => {
      const currentSession = sessionRef.current;
      if (currentSession) {
        persistDraft(currentSession, answerRef.current, selectedChipIdsRef.current);
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [persistDraft]);

  useEffect(() => {
    if (
      (session?.phase === "recall" || session?.phase === "retry") &&
      session.inputMode === "typed"
    ) {
      typedInput.current?.focus();
    }
  }, [session?.inputMode, session?.phase]);

  const recallHintLetter = useMemo(
    () => (current ? firstEnglishLetter(current.en) : null),
    [current],
  );
  const canShowRecallAssist =
    status === "ready"
    && session?.phase === "recall"
    && Boolean(current)
    && Boolean(recallHintLetter)
    && !submittedAnswer.trim()
    && !busy;

  useEffect(() => {
    setRecallAssistVisible(false);
    if (!canShowRecallAssist) return;
    const timeoutId = window.setTimeout(
      () => setRecallAssistVisible(true),
      WIND_DOWN_IDLE_ASSIST_DELAY_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [canShowRecallAssist, current?.id, submittedAnswer]);

  const progress = queueProgress(session, initialCount);
  const ratingCount = useMemo(() => {
    const results = session?.results ?? [];
    return {
      good: results.filter((result) => result.rating === "good").length,
      hard: results.filter((result) => result.rating === "hard").length,
      again: results.filter((result) => result.rating === "again").length,
    };
  }, [session?.results]);
  const lumiState: WindDownLumiState =
    status === "loading"
      ? "thinking"
      : status === "error"
        ? "rescue"
        : session?.phase === "summary"
          ? initialCount > 0
            ? "celebrate"
            : "idle"
          : session?.phase === "grading-first"
            || session?.phase === "grading-retry"
            || session?.phase === "committing"
            ? "thinking"
            : session?.phase === "grade-error-first"
              || session?.phase === "grade-error-retry"
              || session?.phase === "commit-error"
              ? "rescue"
              : session?.phase === "match" || session?.phase === "retry"
                ? "retry"
                : notice?.startsWith("좋아")
                  ? "correct"
                  : "prompt";
  const lumiMessage =
    status === "loading"
      ? "돌아올 문장을 찾는 중"
      : status === "error"
        ? "대기열을 추측하지 않고 멈췄어"
        : session?.phase === "summary"
          ? initialCount > 0
            ? "오늘 돌아볼 문장을 모두 마쳤어"
            : "지금 돌아볼 문장은 없어"
          : session?.phase === "grading-first" || session?.phase === "grading-retry"
            ? "입력한 문장을 확인하는 중"
            : session?.phase === "committing"
              ? "복습 기록을 안전하게 남기는 중"
              : session?.phase === "grade-error-first"
                || session?.phase === "grade-error-retry"
                || session?.phase === "commit-error"
                ? "같은 기록을 지키고 있어"
                : session?.phase === "match" || session?.phase === "retry"
                  ? "감각을 되찾아 한 번 더"
                  : notice ?? "떠오르는 문장을 적어봐";

  return (
    <div className="fixed inset-0 z-[70] min-h-[100dvh] overflow-y-auto bg-[var(--wd-bg)] text-[var(--wd-text)]">
      <div className="min-h-[100dvh] bg-[var(--wd-bg)]">
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),18px)]">
          <header>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black tracking-[0.2em] text-[var(--wd-accent)]">
                  WIND DOWN · REVIEW
                </p>
                <h1 className="mt-1 text-xl font-black tracking-[-0.02em]">
                  기억 회복 라운드
                </h1>
              </div>
              <Link
                href="/winddown"
                className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-white/15 bg-white/5 px-4 text-xs font-black text-white/80"
              >
                나가기
              </Link>
            </div>
            <div className="mt-5 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[var(--wd-accent)] to-[var(--wd-listening)] transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="min-w-10 text-right text-xs font-black tabular-nums text-white/65">
                {session?.results.length ?? 0}/{initialCount}
              </span>
            </div>
            <WindDownLumi
              state={lumiState}
              message={lumiMessage}
              compact
              className="mt-5 rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-surface)] px-4 py-3"
            />
          </header>

          <main className="flex flex-1 flex-col justify-center py-5">
            <section className="min-h-[460px] rounded-[30px] border border-[var(--wd-border)] bg-[var(--wd-surface)] p-5 shadow-2xl sm:p-6">
              {status === "loading" ? (
                <div aria-live="polite" className="flex min-h-[408px] flex-col items-center justify-center text-center">
                  <span className="grid size-16 place-items-center rounded-[22px] bg-[var(--wd-surface-raised)] text-3xl" aria-hidden>
                    ◌
                  </span>
                  <p className="mt-5 text-lg font-black">오늘 돌아올 문장을 찾는 중</p>
                  <p className="mt-2 text-sm font-semibold text-white/55">AI 없이 복습 순서만 확인하고 있어.</p>
                </div>
              ) : null}

              {status === "error" ? (
                <div className="flex min-h-[408px] flex-col justify-center text-center">
                  <p className="text-4xl" aria-hidden>☁︎</p>
                  <h2 className="mt-5 text-xl font-black">복습 대기열을 열지 못했어.</h2>
                  <p className="mt-3 text-sm font-semibold leading-6 text-white/60">
                    이전 문장으로 바꾸지 않았어. 다시 불러오면 정확한 순서로 이어져.
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadQueue()}
                    className="mt-7 min-h-[44px] w-full rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black text-[var(--wd-bg)] active:scale-[0.98]"
                  >
                    다시 불러오기
                  </button>
                </div>
              ) : null}

              {status === "ready" && session?.phase === "summary" ? (
                <div className="flex min-h-[408px] flex-col justify-center text-center">
                  <p className="text-5xl" aria-hidden>{initialCount === 0 ? "🌙" : "✦"}</p>
                  <p className="mt-4 text-[11px] font-black tracking-[0.18em] text-[var(--wd-accent)]">
                    {initialCount === 0 ? "NO DUE CARDS" : "QUEUE COMPLETE"}
                  </p>
                  <h2 className="mt-2 text-2xl font-black">
                    {initialCount === 0 ? "오늘은 돌아올 문장이 없어." : "오늘의 복습을 마쳤어."}
                  </h2>
                  <p className="mt-3 text-sm font-semibold leading-6 text-white/60">
                    {initialCount === 0
                      ? "새 문장은 Learn에서 만나고, 여기서는 간격이 온 문장만 다시 봐."
                      : `정확히 ${ratingCount.good}개 · 회복 ${ratingCount.hard}개 · 다시 만날 문장 ${ratingCount.again}개`}
                  </p>
                  <Link
                    href="/winddown/learn"
                    className="mt-7 inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-surface-raised)] px-5 text-sm font-black text-[var(--wd-text)]"
                  >
                    Learn으로 새 문장 보기
                  </Link>
                </div>
              ) : null}

              {status === "ready" && current && session?.phase === "recall" ? (
                <div className="flex min-h-[408px] flex-col">
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full border border-[var(--wd-border)] bg-[var(--wd-surface-raised)] px-3 py-1.5 text-[10px] font-black tracking-[0.12em] text-[var(--wd-accent)]">RECALL</span>
                    <span className="text-xs font-black tabular-nums text-white/50">남은 문장 {session.queue.length}개</span>
                  </div>
                  <p className="mt-9 text-[11px] font-black tracking-[0.15em] text-[var(--wd-listening)]">한국어를 보고 영어를 떠올려 봐</p>
                  <h2 className="mt-3 text-[27px] font-black leading-[1.35] tracking-[-0.035em]">{current.ko}</h2>
                  <WindDownDeviceSpeechPractice
                    key={`recall:${current.id}`}
                    targetText={current.en}
                    controls="speak-only"
                    showMatchFeedback={false}
                    disabled={busy}
                  />
                  <div className="mt-auto pt-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-black text-white/55">
                        {session.inputMode === "chips"
                          ? "단어를 순서대로 골라 문장 만들기"
                          : "도움 없이 영어 문장 입력하기"}
                      </p>
                      <button
                        type="button"
                        aria-pressed={session.inputMode === "typed"}
                        aria-expanded={session.inputMode === "typed"}
                        aria-controls="review-input-panel"
                        onClick={() =>
                          setInputMode(
                            session.inputMode === "typed" ? "chips" : "typed",
                          )
                        }
                        className="min-h-[44px] shrink-0 rounded-xl border border-[var(--wd-border)] bg-[var(--wd-surface-raised)] px-3 text-xs font-black text-[var(--wd-text)]"
                      >
                        {session.inputMode === "typed" ? "단어 칩" : "직접 입력"}
                      </button>
                    </div>
                    <div id="review-input-panel">
                      {session.inputMode === "chips" && chipExercise ? (
                        <ReviewChipInput
                          exercise={chipExercise}
                          selectedIds={selectedChipIds}
                          onChange={updateSelectedChipIds}
                          disabled={busy}
                          assistVisible={recallAssistVisible}
                        />
                      ) : null}
                      {session.inputMode === "typed" ? (
                        <>
                          <label htmlFor="review-answer" className="sr-only">
                            영어로 직접 입력
                          </label>
                          <input
                            ref={typedInput}
                            id="review-answer"
                            value={answer}
                            onChange={(event) => updateAnswer(event.target.value)}
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" &&
                                !event.nativeEvent.isComposing
                              ) {
                                submitFirst(submittedAnswer);
                              }
                            }}
                            inputMode="text"
                            enterKeyHint="done"
                            maxLength={240}
                            autoComplete="off"
                            autoCapitalize="sentences"
                            spellCheck={false}
                            placeholder="떠오르는 문장을 적어봐"
                            className="mt-4 min-h-14 w-full rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] px-4 text-base font-bold outline-none placeholder:text-[var(--wd-text-muted)] focus:border-[var(--wd-accent)]"
                          />
                        </>
                      ) : null}
                    </div>
                    <p
                      aria-live="polite"
                      className={[
                        "mt-3 min-h-[40px] rounded-xl border px-3 py-2 text-center text-xs font-bold text-[var(--wd-text-muted)]",
                        recallAssistVisible && recallHintLetter
                          ? "border-[var(--wd-border)] bg-[var(--wd-surface-raised)]"
                          : "border-transparent bg-transparent",
                      ].join(" ")}
                    >
                      {recallAssistVisible && recallHintLetter
                        ? session.inputMode === "typed"
                          ? <>
                              루미 힌트: 첫 글자는 <span className="text-[var(--wd-text)]">{recallHintLetter}</span> 이야.
                            </>
                          : "루미 힌트: 첫 단어가 살짝 빛나고 있어."
                        : null}
                    </p>
                    <button
                      type="button"
                      disabled={busy || !submittedAnswer.trim()}
                      onClick={() => submitFirst(submittedAnswer)}
                      className="mt-3 min-h-[44px] w-full rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black text-[var(--wd-bg)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
                    >
                      답 확인하기
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={reveal}
                      className="mt-2 min-h-[44px] w-full px-5 text-xs font-black text-white/55 disabled:opacity-40"
                    >
                      정답 보기 · Again으로 기록
                    </button>
                  </div>
                </div>
              ) : null}

              {status === "ready" && session && ["grading-first", "grading-retry"].includes(session.phase) ? (
                <div aria-live="polite" className="flex min-h-[408px] flex-col items-center justify-center text-center">
                  <span className="grid size-16 place-items-center rounded-[22px] bg-[var(--wd-surface-raised)] text-3xl" aria-hidden>✣</span>
                  <h2 className="mt-5 text-xl font-black">입력한 문장을 정확히 확인하는 중</h2>
                  <p className="mt-2 text-sm font-semibold text-white/55">이 동안에는 다음 동작을 열지 않아.</p>
                </div>
              ) : null}

              {status === "ready" && session && ["grade-error-first", "grade-error-retry"].includes(session.phase) ? (
                <div role="alert" aria-live="polite" className="flex min-h-[408px] flex-col justify-center text-center">
                  <p className="text-4xl" aria-hidden>↻</p>
                  <h2 className="mt-5 text-xl font-black">채점 결과를 아직 받지 못했어.</h2>
                  <p className="mt-3 text-sm font-semibold leading-6 text-white/60">문장과 복습 순서는 그대로야. 같은 기록으로 다시 확인할게.</p>
                  <button
                    type="button"
                    onClick={() => retryGrade(session.phase === "grade-error-first" ? "first" : "retry")}
                    className="mt-7 min-h-[44px] w-full rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black text-[var(--wd-bg)]"
                  >
                    같은 답 다시 채점하기
                  </button>
                </div>
              ) : null}

              {status === "ready" && current && session?.phase === "match" && session.match ? (
                <div className="flex min-h-[408px] flex-col">
                  <div className="flex items-center justify-between gap-3">
                    {session.match.pairs.length === 1 ? (
                      <span data-repair-kind="single-card" className="rounded-full border border-[var(--wd-listening)] bg-[var(--wd-surface-raised)] px-3 py-1.5 text-[10px] font-black tracking-[0.12em] text-[var(--wd-listening)]">
                        한 문장 다시 익히기
                      </span>
                    ) : session.match.pairs.length === 2 ? (
                      <span data-repair-kind="two-card" className="rounded-full border border-[var(--wd-listening)] bg-[var(--wd-surface-raised)] px-3 py-1.5 text-[10px] font-black tracking-[0.12em] text-[var(--wd-listening)]">
                        두 문장 다시 익히기
                      </span>
                    ) : (
                      <span data-repair-kind="three-card" className="rounded-full border border-[var(--wd-listening)] bg-[var(--wd-surface-raised)] px-3 py-1.5 text-[10px] font-black tracking-[0.12em] text-[var(--wd-listening)]">
                        MATCH REPAIR
                      </span>
                    )}
                    <span className="text-xs font-black text-white/50">{session.match.pairs.length}쌍을 맞추면 재도전</span>
                  </div>
                  <h2 className="mt-5 text-xl font-black">문장의 조각을 다시 연결해 봐.</h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-white/55">잘못 짝지은 카드만 잠깐 표시돼. 이 보드는 어떤 기록도 남기지 않아.</p>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    {session.match.tiles.map((tile) => {
                      const matched = session.match?.matchedPairIds.includes(tile.pairId);
                      const selected = session.match?.selectedTileIds.includes(tile.id);
                      const wrong = session.match?.wrongTileIds.includes(tile.id);
                      return (
                        <button
                          key={tile.id}
                          type="button"
                          disabled={busy || matched}
                          aria-pressed={Boolean(selected || matched)}
                          aria-describedby={wrong ? "review-match-feedback" : undefined}
                          aria-label={`${tile.label} ${tile.side === "left" ? "영어" : "한국어"}`}
                          onClick={() => selectMatchTile(tile.id)}
                          className={[
                            "min-h-20 min-w-0 break-words rounded-2xl border px-3 py-3 text-left text-sm font-black leading-snug transition motion-reduce:transition-none",
                            matched ? "border-[var(--wd-listening)] bg-[var(--wd-surface)] text-[var(--wd-text-muted)]" : "border-[var(--wd-border)] bg-[var(--wd-surface-raised)] text-[var(--wd-text)]",
                            selected ? "border-[var(--wd-accent)] bg-[var(--wd-surface)]" : "",
                            wrong ? "border-[var(--wd-danger)] bg-[var(--wd-surface-raised)]" : "",
                          ].join(" ")}
                        >
                          <span className="block text-[10px] font-black tracking-[0.1em] text-white/40">{tile.side === "left" ? "CUE" : "PAIR"}</span>
                          <span className="mt-1 block">{tile.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {session.match.wrongTileIds.length > 0 ? (
                    <p id="review-match-feedback" role="status" aria-live="polite" className="mt-4 text-center text-sm font-black text-[var(--wd-danger)]">아직 아니야. 다른 짝을 골라 봐.</p>
                  ) : null}
                  <p className="mt-auto pt-4 text-center text-xs font-bold text-white/45">{session.match.matchedPairIds.length}/{session.match.pairs.length} 연결</p>
                </div>
              ) : null}

              {status === "ready" && current && session?.phase === "retry" ? (
                <div className="flex min-h-[408px] flex-col">
                  <span className="w-fit rounded-full border border-[var(--wd-listening)] bg-[var(--wd-surface-raised)] px-3 py-1.5 text-[10px] font-black tracking-[0.12em] text-[var(--wd-listening)]">ONE RETRY</span>
                  <p className="mt-8 text-[11px] font-black tracking-[0.15em] text-[var(--wd-listening)]">연결한 감각으로 한 번만 다시 입력</p>
                  <h2 className="mt-3 text-[27px] font-black leading-[1.35] tracking-[-0.035em]">{current.ko}</h2>
                  <WindDownDeviceSpeechPractice
                    key={`retry:${current.id}`}
                    targetText={current.en}
                    controls="listen-and-speak"
                    showMatchFeedback={false}
                    disabled={busy}
                  />
                  <div className="mt-auto pt-5">
                    <p className="text-xs font-black text-white/55">
                      {session.inputMode === "chips"
                        ? "같은 단어 칩으로 다시 연결해 봐"
                        : "같은 직접 입력 방식으로 다시 적어봐"}
                    </p>
                    {session.inputMode === "chips" && chipExercise ? (
                      <ReviewChipInput
                        exercise={chipExercise}
                        selectedIds={selectedChipIds}
                        onChange={updateSelectedChipIds}
                        disabled={busy}
                        assistVisible={false}
                        accent="var(--wd-listening)"
                      />
                    ) : null}
                    {session.inputMode === "typed" ? (
                      <>
                        <label htmlFor="review-retry" className="sr-only">
                          영어로 다시 입력
                        </label>
                        <input
                          ref={typedInput}
                          id="review-retry"
                          value={answer}
                          onChange={(event) => updateAnswer(event.target.value)}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Enter" &&
                              !event.nativeEvent.isComposing
                            ) {
                              submitRetry(submittedAnswer);
                            }
                          }}
                          inputMode="text"
                          enterKeyHint="done"
                          maxLength={240}
                          autoComplete="off"
                          autoCapitalize="sentences"
                          spellCheck={false}
                          placeholder="이번에는 문장을 끝까지 적어봐"
                          className="mt-4 min-h-14 w-full rounded-2xl border border-[var(--wd-listening)] bg-[var(--wd-bg)] px-4 text-base font-bold outline-none placeholder:text-[var(--wd-text-muted)] focus:border-[var(--wd-listening)]"
                        />
                      </>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy || !submittedAnswer.trim()}
                      onClick={() => submitRetry(submittedAnswer)}
                      className="mt-3 min-h-[44px] w-full rounded-2xl bg-[var(--wd-listening)] px-5 text-sm font-black text-[var(--wd-bg)] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      한 번만 다시 확인하기
                    </button>
                  </div>
                </div>
              ) : null}

              {status === "ready" && session?.phase === "committing" ? (
                <div aria-live="polite" className="flex min-h-[408px] flex-col items-center justify-center text-center">
                  <span className="grid size-16 place-items-center rounded-[22px] bg-[var(--wd-surface-raised)] text-3xl" aria-hidden>✦</span>
                  <h2 className="mt-5 text-xl font-black">한 번의 복습 기록으로 남기는 중</h2>
                  <p className="mt-2 text-sm font-semibold text-white/55">같은 주기와 같은 문장으로만 저장해.</p>
                </div>
              ) : null}

              {status === "ready" && session?.phase === "commit-error" ? (
                <div role="alert" aria-live="polite" className="flex min-h-[408px] flex-col justify-center text-center">
                  <p className="text-4xl" aria-hidden>⌁</p>
                  <h2 className="mt-5 text-xl font-black">복습 기록이 아직 완료되지 않았어.</h2>
                  <p className="mt-3 text-sm font-semibold leading-6 text-white/60">답과 복습 주기는 그대로 보관했어. 같은 기록만 다시 전송해.</p>
                  <button
                    type="button"
                    onClick={retryCommit}
                    className="mt-7 min-h-[44px] w-full rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black text-[var(--wd-bg)]"
                  >
                    같은 기록 다시 저장하기
                  </button>
                </div>
              ) : null}
            </section>

            {draftRecoveryNotice ? (
              <div
                className="mt-4 rounded-2xl border border-[var(--wd-danger)]/30 bg-[var(--wd-danger)]/5 p-4 text-center"
              >
                <p role="status" aria-live="polite" className="text-sm font-bold text-[var(--wd-danger)]">
                  {draftRecoveryNotice}
                </p>
                {draftRecoveryAvailable ? (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    {draftRecoveryActionAvailable ? (
                      <button
                        type="button"
                        data-draft-recovery-action="archive"
                        onClick={archiveRejectedDraftAndContinue}
                        className="min-h-[48px] flex-1 rounded-xl bg-[var(--wd-danger)] px-4 text-xs font-black text-[var(--wd-bg)]"
                      >
                        이전 기록 보관하고 이어가기
                      </button>
                    ) : null}
                    <button
                      type="button"
                      data-draft-recovery-action="download"
                      onClick={downloadDraftRecovery}
                      className="min-h-[48px] flex-1 rounded-xl border border-[var(--wd-border)] bg-[var(--wd-surface-raised)] px-4 text-xs font-black text-[var(--wd-text)]"
                    >
                      보관한 기록 내려받기
                    </button>
                  </div>
                ) : null}
                {draftExportAcknowledgmentAvailable ? (
                  <div className="mt-3 rounded-xl border border-[var(--wd-border)] bg-[var(--wd-surface-raised)] p-3 text-left">
                    <p className="text-xs font-semibold leading-5 text-white/65">
                      내려받은 파일을 안전한 곳에 보관했다면, 브라우저의 활성 기록을 비우고 새 이어하기 기록을 만들 수 있어. 저장된 서버 복습 기록에는 영향을 주지 않아.
                    </p>
                    <button
                      type="button"
                      data-draft-recovery-action="acknowledge-export"
                      onClick={clearExportedDraftAndContinue}
                      className="mt-3 min-h-[48px] w-full rounded-xl bg-[var(--wd-accent)] px-4 text-xs font-black text-[var(--wd-bg)]"
                    >
                      파일을 보관했어 · 새 기록으로 이어가기
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {draftStorageNotice ? (
              <p role="status" aria-live="polite" className="mt-4 text-center text-sm font-bold text-white/60">
                {draftStorageNotice}
              </p>
            ) : null}
            {notice ? <p aria-live="polite" className="mt-4 text-center text-sm font-bold text-white/65">{notice}</p> : null}
          </main>

          <p className="pb-1 text-center text-[11px] font-bold text-white/40">기기 받아쓰기는 선택 사항이며, 제출 전까지 복습 기록을 바꾸지 않아.</p>
        </div>
      </div>
    </div>
  );
}
