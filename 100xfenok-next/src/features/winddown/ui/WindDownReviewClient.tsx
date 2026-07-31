"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyWindDownReviewAction,
  createWindDownReviewSession,
  type WindDownReviewCard,
  type WindDownReviewCommitInput,
  type WindDownReviewState,
} from "@/features/winddown/review/engine";
import {
  WindDownLumi,
  type WindDownLumiState,
} from "@/features/winddown/ui/WindDownLumi";

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
      typeof material.contentDigest === "string",
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
    (receipt.reward !== 0 && receipt.reward !== 1)
  ) {
    return null;
  }
  return receipt as ReviewReceipt;
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

export default function WindDownReviewClient() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [session, setSession] = useState<WindDownReviewState | null>(null);
  const [initialCount, setInitialCount] = useState(0);
  const [answer, setAnswer] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const loadQueue = useCallback(async (reloadNotice: string | null = null) => {
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    setStatus("loading");
    setSession(null);
    setAnswer("");
    setNotice(reloadNotice);
    try {
      const response = await fetch("/api/winddown/study?mode=review", {
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (!response.ok || !isStudyResponse(body)) {
        throw new Error("winddown_review_bootstrap_invalid");
      }
      if (loadSequence.current !== sequence) return;
      setInitialCount(body.cards.length);
      setSession(
        createWindDownReviewSession({
          cards: body.cards,
          contentDigest: body.material.contentDigest,
        }),
      );
      setStatus("ready");
    } catch {
      if (loadSequence.current !== sequence) return;
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const reloadForCycleChange = useCallback(() => {
    void loadQueue("복습 순서가 바뀌어서 오늘의 대기열을 새로 불렀어.");
  }, [loadQueue]);

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
          receipt.materialId !== input.materialId
        ) {
          throw new ReviewApiError("REVIEW_API_FAILED");
        }
        const next = applyWindDownReviewAction(committingState, {
          type: "commit-succeeded",
          result: {
            materialId: receipt.materialId,
            rating: receipt.rating,
            reward: receipt.reward,
          },
        });
        if (next.outcome === "invalid") throw new ReviewApiError("REVIEW_API_FAILED");
        setSession(next.state);
        setAnswer("");
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
        if (failed.outcome !== "invalid") setSession(failed.state);
      }
    },
    [reloadForCycleChange],
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
        setSession(next.state);
        if (next.state.phase === "match") setAnswer("");
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
        if (failed.outcome !== "invalid") setSession(failed.state);
      }
    },
    [commit, reloadForCycleChange],
  );

  const submitFirst = () => {
    if (!session || isBusy(session)) return;
    const next = applyWindDownReviewAction(session, {
      type: "submit-first",
      answer,
    });
    if (next.outcome === "invalid") return;
    setSession(next.state);
    setNotice(null);
    void grade(next.state, "first");
  };

  const reveal = () => {
    if (!session || isBusy(session)) return;
    const next = applyWindDownReviewAction(session, { type: "reveal" });
    if (next.outcome === "invalid") return;
    setSession(next.state);
    setNotice(null);
    void commit(next.state);
  };

  const submitRetry = () => {
    if (!session || isBusy(session)) return;
    const next = applyWindDownReviewAction(session, {
      type: "submit-retry",
      answer,
    });
    if (next.outcome === "invalid") return;
    setSession(next.state);
    setNotice(null);
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
    setSession(next.state);
    void grade(next.state, stage);
  };

  const retryCommit = () => {
    if (!session || isBusy(session)) return;
    const next = applyWindDownReviewAction(session, { type: "retry-commit" });
    if (next.outcome === "invalid") return;
    setSession(next.state);
    void commit(next.state);
  };

  const selectMatchTile = (tileId: string) => {
    if (!session || isBusy(session)) return;
    const next = applyWindDownReviewAction(session, {
      type: "select-match-tile",
      tileId,
    });
    if (next.outcome === "invalid") return;
    setSession(next.state);
  };

  const busy = isBusy(session);
  const current = session?.queue[0] ?? null;
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
                    className="mt-7 min-h-[44px] w-full rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black active:scale-[0.98]"
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
                  <div className="mt-auto pt-8">
                    <label htmlFor="review-answer" className="text-xs font-black text-white/55">영어로 직접 입력</label>
                    <input
                      id="review-answer"
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") submitFirst();
                      }}
                      maxLength={240}
                      autoComplete="off"
                      autoCapitalize="sentences"
                      spellCheck={false}
                      placeholder="떠오르는 문장을 적어봐"
                      className="mt-2 min-h-14 w-full rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] px-4 text-base font-bold outline-none placeholder:text-[var(--wd-text-muted)] focus:border-[var(--wd-accent)]"
                    />
                    <button
                      type="button"
                      disabled={busy || !answer.trim()}
                      onClick={submitFirst}
                      className="mt-3 min-h-[44px] w-full rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
                    >
                      답 확인하기
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={reveal}
                      className="mt-3 min-h-[44px] w-full rounded-2xl border border-white/15 bg-white/[0.03] px-5 text-sm font-black text-white/80 disabled:opacity-40"
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
                <div className="flex min-h-[408px] flex-col justify-center text-center">
                  <p className="text-4xl" aria-hidden>↻</p>
                  <h2 className="mt-5 text-xl font-black">채점 결과를 아직 받지 못했어.</h2>
                  <p className="mt-3 text-sm font-semibold leading-6 text-white/60">문장과 복습 순서는 그대로야. 같은 기록으로 다시 확인할게.</p>
                  <button
                    type="button"
                    onClick={() => retryGrade(session.phase === "grade-error-first" ? "first" : "retry")}
                    className="mt-7 min-h-[44px] w-full rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black"
                  >
                    같은 답 다시 채점하기
                  </button>
                </div>
              ) : null}

              {status === "ready" && current && session?.phase === "match" && session.match ? (
                <div className="flex min-h-[408px] flex-col">
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full border border-[var(--wd-listening)] bg-[var(--wd-surface-raised)] px-3 py-1.5 text-[10px] font-black tracking-[0.12em] text-[var(--wd-listening)]">MATCH REPAIR</span>
                    <span className="text-xs font-black text-white/50">3쌍을 맞추면 재도전</span>
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
                          onClick={() => selectMatchTile(tile.id)}
                          className={[
                            "min-h-20 rounded-2xl border px-3 py-3 text-left text-sm font-black leading-snug transition motion-reduce:transition-none",
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
                    <p aria-live="polite" className="mt-4 text-center text-sm font-black text-[var(--wd-danger)]">아직 아니야. 다른 짝을 골라 봐.</p>
                  ) : null}
                  <p className="mt-auto pt-4 text-center text-xs font-bold text-white/45">{session.match.matchedPairIds.length}/3 연결</p>
                </div>
              ) : null}

              {status === "ready" && current && session?.phase === "retry" ? (
                <div className="flex min-h-[408px] flex-col">
                  <span className="w-fit rounded-full border border-[var(--wd-listening)] bg-[var(--wd-surface-raised)] px-3 py-1.5 text-[10px] font-black tracking-[0.12em] text-[var(--wd-listening)]">ONE RETRY</span>
                  <p className="mt-8 text-[11px] font-black tracking-[0.15em] text-[var(--wd-listening)]">연결한 감각으로 한 번만 다시 입력</p>
                  <h2 className="mt-3 text-[27px] font-black leading-[1.35] tracking-[-0.035em]">{current.ko}</h2>
                  <div className="mt-auto pt-8">
                    <label htmlFor="review-retry" className="text-xs font-black text-white/55">영어로 다시 입력</label>
                    <input
                      id="review-retry"
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") submitRetry();
                      }}
                      maxLength={240}
                      autoComplete="off"
                      autoCapitalize="sentences"
                      spellCheck={false}
                      placeholder="이번에는 문장을 끝까지 적어봐"
                      className="mt-2 min-h-14 w-full rounded-2xl border border-[var(--wd-listening)] bg-[var(--wd-bg)] px-4 text-base font-bold outline-none placeholder:text-[var(--wd-text-muted)] focus:border-[var(--wd-listening)]"
                    />
                    <button
                      type="button"
                      disabled={busy || !answer.trim()}
                      onClick={submitRetry}
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
                <div className="flex min-h-[408px] flex-col justify-center text-center">
                  <p className="text-4xl" aria-hidden>⌁</p>
                  <h2 className="mt-5 text-xl font-black">복습 기록이 아직 완료되지 않았어.</h2>
                  <p className="mt-3 text-sm font-semibold leading-6 text-white/60">답과 복습 주기는 그대로 보관했어. 같은 기록만 다시 전송해.</p>
                  <button
                    type="button"
                    onClick={retryCommit}
                    className="mt-7 min-h-[44px] w-full rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black"
                  >
                    같은 기록 다시 저장하기
                  </button>
                </div>
              ) : null}
            </section>

            {notice ? <p aria-live="polite" className="mt-4 text-center text-sm font-bold text-white/65">{notice}</p> : null}
          </main>

          <p className="pb-1 text-center text-[11px] font-bold text-white/40">이 복습은 마이크·대화 모델·실시간 연결을 열지 않아.</p>
        </div>
      </div>
    </div>
  );
}
