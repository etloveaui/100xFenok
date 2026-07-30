"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WINDDOWN_LEARN_CREDIT_TARGET,
  applyWindDownLearnAction,
  createWindDownLearnSession,
  type WindDownLearnAction,
  type WindDownLearnCard,
  type WindDownLearnState,
} from "@/features/winddown/learn/engine";

type StudyResponse = {
  schemaVersion: 1;
  mode: "learn";
  modelOpened: false;
  cards: WindDownLearnCard[];
  inventory: {
    selectedCount: number;
    insufficientFreshCount: number;
  };
  material: {
    source: "published-lkg" | "legacy-fallback";
    publicationStatus: "active" | "absent" | "invalid";
    contentDigest: string | null;
  };
};

type ProgressPayload = {
  schemaVersion: 1;
  activity: "learn";
  attemptId: string;
  sessionId: string;
  sequence: number;
  materialId: string;
  contentDigest: string;
  occurredAt: string;
  verdict: "canonical" | "close";
};

type Feedback = {
  outcome: "miss" | "practice" | "correct" | "complete";
  nextState: WindDownLearnState;
  card: WindDownLearnCard;
  progress: ProgressPayload | null;
  persisted: boolean;
  saveError: boolean;
};

function kstDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function newSessionId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `session-${Date.now().toString(36)}`;
}

function isStudyResponse(value: unknown): value is StudyResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Partial<StudyResponse>;
  return (
    source.schemaVersion === 1 &&
    source.mode === "learn" &&
    source.modelOpened === false &&
    Array.isArray(source.cards) &&
    source.material?.source === "published-lkg" &&
    source.material.publicationStatus === "active" &&
    typeof source.material.contentDigest === "string"
  );
}

export default function WindDownLearnClient() {
  const sessionIdRef = useRef(newSessionId());
  const [session, setSession] = useState<WindDownLearnState | null>(null);
  const [contentDigest, setContentDigest] = useState<string | null>(null);
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  const loadQuest = useCallback(async () => {
    setStatus("loading");
    setFeedback(null);
    setSelectedTokenIds([]);
    try {
      const seed = `${kstDay()}:learn`;
      const response = await fetch(
        `/api/winddown/study?mode=learn&count=${WINDDOWN_LEARN_CREDIT_TARGET}&seed=${encodeURIComponent(seed)}`,
        { cache: "no-store" },
      );
      const body: unknown = await response.json();
      if (
        !response.ok ||
        !isStudyResponse(body) ||
        body.cards.length !== WINDDOWN_LEARN_CREDIT_TARGET
      ) {
        throw new Error("winddown_learn_bootstrap_invalid");
      }
      setContentDigest(body.material.contentDigest);
      setSession(createWindDownLearnSession({ cards: body.cards, seed }));
      setStatus("ready");
    } catch {
      setSession(null);
      setContentDigest(null);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadQuest();
  }, [loadQuest]);

  const current = session?.queue[0] ?? null;
  const progress = session
    ? Math.round((session.creditedCardIds.length / session.targetActions) * 100)
    : 0;
  const selectedTokens = useMemo(() => {
    if (!current || current.kind !== "sentence-builder") return [];
    const byId = new Map(current.tokens.map((token) => [token.id, token]));
    return selectedTokenIds.flatMap((id) => {
      const token = byId.get(id);
      return token ? [token] : [];
    });
  }, [current, selectedTokenIds]);

  const persistProgress = useCallback(async (payload: ProgressPayload) => {
    const response = await fetch("/api/winddown/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => null)) as {
      persisted?: boolean;
    } | null;
    if (!response.ok || body?.persisted !== true) {
      throw new Error("winddown_learn_progress_failed");
    }
  }, []);

  const saveFeedback = useCallback(
    async (currentFeedback: Feedback) => {
      if (!currentFeedback.progress) return;
      const attemptId = currentFeedback.progress.attemptId;
      setFeedback({ ...currentFeedback, saveError: false });
      try {
        await persistProgress(currentFeedback.progress);
        setFeedback((latest) =>
          latest && latest.progress?.attemptId === attemptId
            ? { ...latest, persisted: true, saveError: false }
            : latest,
        );
      } catch {
        setFeedback((latest) =>
          latest && latest.progress?.attemptId === attemptId
            ? { ...latest, persisted: false, saveError: true }
            : latest,
        );
      }
    },
    [persistProgress],
  );

  const submit = useCallback(
    (action: WindDownLearnAction) => {
      if (!session || !current || feedback || !contentDigest) return;
      const result = applyWindDownLearnAction(session, action);
      if (result.outcome === "invalid") return;
      const recovered = session.mistakes.some(
        (mistake) => mistake.card.id === current.card.id,
      );
      const progressPayload: ProgressPayload | null =
        result.reward === 1
          ? {
              schemaVersion: 1,
              activity: "learn",
              attemptId: `${sessionIdRef.current}:${session.creditedCardIds.length + 1}:${current.card.id}`,
              sessionId: sessionIdRef.current,
              sequence: session.creditedCardIds.length + 1,
              materialId: current.card.id,
              contentDigest,
              occurredAt: new Date().toISOString(),
              verdict: recovered ? "close" : "canonical",
            }
          : null;
      const nextFeedback: Feedback = {
        outcome: result.outcome,
        nextState: result.state,
        card: current.card,
        progress: progressPayload,
        persisted: progressPayload === null,
        saveError: false,
      };
      setFeedback(nextFeedback);
      setSelectedTokenIds([]);
      if (progressPayload) void saveFeedback(nextFeedback);
    },
    [contentDigest, current, feedback, saveFeedback, session],
  );

  const continueQuest = () => {
    if (!feedback?.persisted) return;
    setSession(feedback.nextState);
    setFeedback(null);
    setSelectedTokenIds([]);
  };

  return (
    <div className="fixed inset-0 z-[70] min-h-[100dvh] overflow-y-auto bg-[var(--fnk-neutral-950)] text-[var(--fnk-color-white)]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),18px)]">
        <header>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-black tracking-[0.2em] text-[var(--fnk-purple-600)]">
                WIND DOWN · LEARN
              </p>
              <h1 className="mt-1 text-xl font-black">오늘의 다섯 문장</h1>
            </div>
            <Link
              href="/winddown"
              className="inline-flex min-h-14 items-center rounded-full border border-[var(--fnk-neutral-700)] px-4 text-xs font-black text-[var(--fnk-neutral-300)]"
            >
              나가기
            </Link>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--fnk-neutral-800)]">
              <div
                className="h-full rounded-full bg-[var(--fnk-purple-600)] transition-[width] motion-reduce:transition-none"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="min-w-10 text-right text-xs font-black tabular-nums text-[var(--fnk-neutral-300)]">
              {session?.creditedCardIds.length ?? 0}/
              {WINDDOWN_LEARN_CREDIT_TARGET}
            </span>
          </div>
        </header>

        <main className="flex flex-1 flex-col justify-center py-6">
          {status === "loading" ? (
            <section
              aria-live="polite"
              className="rounded-[28px] border border-[var(--fnk-neutral-800)] bg-[var(--fnk-neutral-900)] p-8 text-center"
            >
              <p className="text-4xl" aria-hidden>
                🌙
              </p>
              <p className="mt-4 text-base font-black">
                루미가 오늘 문장을 고르는 중
              </p>
            </section>
          ) : null}

          {status === "error" ? (
            <section className="rounded-[28px] border border-[var(--fnk-neutral-800)] bg-[var(--fnk-neutral-900)] p-7 text-center">
              <p className="text-lg font-black">문장을 안전하게 열지 못했어.</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[var(--fnk-neutral-300)]">
                이전 소재로 조용히 바꾸지 않았어. 다시 불러오면 돼.
              </p>
              <button
                type="button"
                onClick={() => void loadQuest()}
                className="mt-6 min-h-14 w-full rounded-2xl bg-[var(--fnk-purple-600)] px-5 text-sm font-black"
              >
                다시 불러오기
              </button>
            </section>
          ) : null}

          {status === "ready" && session?.isComplete ? (
            <section className="rounded-[28px] border border-[var(--fnk-neutral-800)] bg-[var(--fnk-neutral-900)] p-7 text-center">
              <p className="text-5xl" aria-hidden>
                ✨
              </p>
              <p className="mt-4 text-[11px] font-black tracking-[0.18em] text-[var(--fnk-purple-600)]">
                QUEST COMPLETE
              </p>
              <h2 className="mt-2 text-2xl font-black">다섯 문장 완료!</h2>
              <p className="mt-3 text-sm font-semibold text-[var(--fnk-neutral-300)]">
                틀린 문장 {session.completion?.mistakeRecap.length ?? 0}개도
                다시 성공했어.
              </p>
              {(session.completion?.mistakeRecap.length ?? 0) > 0 ? (
                <ul className="mt-5 space-y-2 text-left">
                  {session.completion?.mistakeRecap.map((mistake) => (
                    <li
                      key={mistake.card.id}
                      className="rounded-2xl bg-[var(--fnk-neutral-800)] px-4 py-3"
                    >
                      <p className="text-xs font-bold text-[var(--fnk-neutral-300)]">
                        {mistake.card.ko}
                      </p>
                      <p className="mt-1 text-sm font-black">
                        {mistake.card.en}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {status === "ready" && current && !session?.isComplete ? (
            <section className="rounded-[28px] border border-[var(--fnk-neutral-800)] bg-[var(--fnk-neutral-900)] p-6 shadow-2xl">
              {feedback ? (
                <div aria-live="polite" className="text-center">
                  <p className="text-4xl" aria-hidden>
                    {feedback.outcome === "miss" ? "🌱" : "✨"}
                  </p>
                  <h2 className="mt-4 text-xl font-black">
                    {feedback.outcome === "miss"
                      ? "괜찮아, 잠시 뒤 다시 만나자."
                      : feedback.outcome === "practice"
                        ? "좋아, 감각을 되찾았어."
                        : feedback.outcome === "complete"
                          ? "마지막 문장까지 성공!"
                          : "좋아, 한 문장 쌓였어."}
                  </h2>
                  <p className="mt-3 text-base font-black">
                    {feedback.card.en}
                  </p>
                  {feedback.saveError ? (
                    <p className="mt-4 rounded-2xl bg-[var(--fnk-loss-900)] px-4 py-3 text-sm font-bold">
                      결과가 아직 저장되지 않았어. 같은 기록으로 다시 저장할게.
                    </p>
                  ) : null}
                  {feedback.progress && !feedback.persisted ? (
                    <button
                      type="button"
                      onClick={() => void saveFeedback(feedback)}
                      disabled={!feedback.saveError}
                      className="mt-6 min-h-14 w-full rounded-2xl bg-[var(--fnk-purple-600)] px-5 text-sm font-black disabled:opacity-60"
                    >
                      {feedback.saveError ? "저장 다시 시도" : "결과 저장 중"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={continueQuest}
                      className="mt-6 min-h-14 w-full rounded-2xl bg-[var(--fnk-purple-600)] px-5 text-sm font-black"
                    >
                      {feedback.outcome === "complete"
                        ? "오늘 결과 보기"
                        : "다음 문제"}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full bg-[var(--fnk-neutral-800)] px-3 py-1.5 text-[10px] font-black tracking-[0.1em] text-[var(--fnk-neutral-300)]">
                      {current.kind === "meaning-choice"
                        ? "뜻 고르기"
                        : "문장 조립"}
                    </span>
                    <span className="text-xs font-black tabular-nums text-[var(--fnk-neutral-300)]">
                      {current.creditPolicy === "practice-only"
                        ? "보상 없는 짧은 연습"
                        : `${(session?.creditedCardIds.length ?? 0) + 1}번째`}
                    </span>
                  </div>

                  {current.kind === "meaning-choice" ? (
                    <>
                      <p className="mt-7 text-xs font-black tracking-[0.15em] text-[var(--fnk-purple-600)]">
                        이 영어의 뜻은?
                      </p>
                      <h2 className="mt-3 text-2xl font-black leading-snug">
                        {current.card.en}
                      </h2>
                      <div className="mt-7 grid gap-3">
                        {current.choices.map((choice) => (
                          <button
                            key={choice.id}
                            type="button"
                            onClick={() =>
                              submit({
                                type: "choose-meaning",
                                cardId: current.card.id,
                                choiceId: choice.id,
                              })
                            }
                            className="min-h-14 rounded-2xl border border-[var(--fnk-neutral-700)] bg-[var(--fnk-neutral-800)] px-4 py-3 text-left text-sm font-black transition active:scale-[0.98] motion-reduce:transition-none"
                          >
                            {choice.text}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="mt-7 text-xs font-black tracking-[0.15em] text-[var(--fnk-purple-600)]">
                        영어 문장을 만들어 봐
                      </p>
                      <h2 className="mt-3 text-xl font-black leading-snug">
                        {current.card.ko}
                      </h2>
                      <div
                        aria-label="선택한 단어"
                        className="mt-6 flex min-h-20 flex-wrap content-start gap-2 rounded-2xl border border-dashed border-[var(--fnk-neutral-700)] bg-[var(--fnk-neutral-950)] p-3"
                      >
                        {selectedTokens.length === 0 ? (
                          <span className="text-sm font-semibold text-[var(--fnk-neutral-500)]">
                            아래 단어를 순서대로 눌러봐
                          </span>
                        ) : null}
                        {selectedTokens.map((token) => (
                          <button
                            key={token.id}
                            type="button"
                            onClick={() =>
                              setSelectedTokenIds((ids) =>
                                ids.filter((id) => id !== token.id),
                              )
                            }
                            className="min-h-11 rounded-xl bg-[var(--fnk-purple-600)] px-3 text-sm font-black"
                          >
                            {token.text}
                          </button>
                        ))}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {current.tokens.map((token) => {
                          const selected = selectedTokenIds.includes(token.id);
                          return (
                            <button
                              key={token.id}
                              type="button"
                              disabled={selected}
                              onClick={() =>
                                setSelectedTokenIds((ids) => [...ids, token.id])
                              }
                              className="min-h-11 rounded-xl border border-[var(--fnk-neutral-700)] bg-[var(--fnk-neutral-800)] px-3 text-sm font-black disabled:opacity-25"
                            >
                              {token.text}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        disabled={
                          selectedTokenIds.length !==
                          current.canonicalTokenIds.length
                        }
                        onClick={() =>
                          submit({
                            type: "submit-sentence",
                            cardId: current.card.id,
                            tokenIds: selectedTokenIds,
                          })
                        }
                        className="mt-6 min-h-14 w-full rounded-2xl bg-[var(--fnk-purple-600)] px-5 text-sm font-black disabled:opacity-35"
                      >
                        확인
                      </button>
                    </>
                  )}
                </>
              )}
            </section>
          ) : null}
        </main>

        <p className="pb-1 text-center text-[11px] font-bold text-[var(--fnk-neutral-500)]">
          이 모드에서는 마이크와 AI 대화를 열지 않아.
        </p>
      </div>
    </div>
  );
}
