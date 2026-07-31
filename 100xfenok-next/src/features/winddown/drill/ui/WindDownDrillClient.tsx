"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isWindDownDrillResponsePayload } from "@/features/winddown/drill/clientContract";
import {
  WINDDOWN_DRILL_ROUND_TARGET,
  applyWindDownDrillAction,
  replayWindDownDrillSession,
  type WindDownDrillState,
} from "@/features/winddown/drill/engine";

export default function WindDownDrillClient() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [session, setSession] = useState<WindDownDrillState | null>(null);

  const loadDrill = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/winddown/drill", { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isWindDownDrillResponsePayload(body)) {
        throw new Error("winddown_drill_bootstrap_invalid");
      }
      setSession(body.session);
      setStatus("ready");
    } catch {
      setSession(null);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadDrill();
  }, [loadDrill]);

  const round = session?.rounds[session.roundIndex] ?? null;
  const progress = session
    ? Math.round((session.results.length / WINDDOWN_DRILL_ROUND_TARGET) * 100)
    : 0;
  const roundLabel = session?.phase === "complete"
    ? WINDDOWN_DRILL_ROUND_TARGET
    : Math.min((session?.roundIndex ?? 0) + 1, WINDDOWN_DRILL_ROUND_TARGET);
  const resultLine = useMemo(() => {
    if (!session?.feedback) return null;
    return session.feedback.correct
      ? session.feedback.combo > 1
        ? `${session.feedback.combo} 콤보 · +${session.feedback.points}점`
        : `정답 · +${session.feedback.points}점`
      : "콤보가 끊겼지만 다음 라운드는 새로 시작해";
  }, [session?.feedback]);

  const answer = (roundId: string, choiceId: string) => {
    setSession((current) => current
      ? applyWindDownDrillAction(current, { type: "answer", roundId, choiceId })
      : current);
  };

  const continueDrill = () => {
    setSession((current) => current
      ? applyWindDownDrillAction(current, { type: "continue" })
      : current);
  };

  const replay = () => {
    setSession((current) => current ? replayWindDownDrillSession(current) : current);
  };

  return (
    <div className="fixed inset-0 z-[70] min-h-[100dvh] overflow-y-auto bg-[var(--wd-bg)] text-[var(--wd-text)]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),18px)]">
        <header>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black tracking-[0.18em] text-[var(--wd-accent)]">WIND DOWN · QUICK DRILL</p>
              <h1 className="mt-1 text-xl font-black">다섯 번, 한 번에 하나</h1>
            </div>
            <Link href="/winddown" className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-[var(--wd-border)] px-4 text-xs font-black text-[var(--wd-muted)]">
              나가기
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-[1fr_auto_auto] items-center gap-3">
            <div className="h-2 overflow-hidden rounded-full bg-[var(--wd-surface-raised)]">
              <div
                className="h-full rounded-full bg-[var(--wd-accent)] transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs font-black tabular-nums text-[var(--wd-muted)]">{roundLabel}/{WINDDOWN_DRILL_ROUND_TARGET}</span>
            <span className="rounded-full bg-[var(--wd-surface)] px-3 py-2 text-xs font-black tabular-nums">{session?.score ?? 0}점</span>
          </div>
        </header>

        <main className="flex flex-1 flex-col justify-center py-6">
          {status === "loading" ? (
            <section aria-busy="true" aria-live="polite" className="rounded-[28px] border border-[var(--wd-border)] bg-[var(--wd-surface)] p-8 text-center">
              <p className="text-lg font-black">Quick Drill 준비 중</p>
              <p className="mt-2 text-sm font-semibold text-[var(--wd-muted)]">출판된 문장으로 같은 보드를 만들고 있어.</p>
            </section>
          ) : null}

          {status === "error" ? (
            <section role="alert" className="rounded-[28px] border border-[var(--wd-border)] bg-[var(--wd-surface)] p-7 text-center">
              <h2 className="text-xl font-black">Drill을 안전하게 열지 못했어.</h2>
              <p className="mt-3 text-sm font-semibold text-[var(--wd-muted)]">다른 자료로 바꾸지 않았어. 다시 불러오면 돼.</p>
              <button type="button" onClick={() => void loadDrill()} className="mt-6 min-h-[44px] w-full rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black text-[var(--wd-bg)] transition active:scale-[.98] motion-reduce:transition-none">
                다시 불러오기
              </button>
            </section>
          ) : null}

          {status === "ready" && session?.phase === "prompt" && round ? (
            <section className="rounded-[28px] border border-[var(--wd-border)] bg-[var(--wd-surface)] p-6 shadow-2xl">
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-[var(--wd-accent-soft)] px-3 py-1.5 text-[10px] font-black tracking-[.12em] text-[var(--wd-accent)]">뜻을 한 번에 골라</span>
                <span className="text-xs font-black text-[var(--wd-muted)]">콤보 {session.combo}</span>
              </div>
              <h2 className="mt-8 text-[26px] font-black leading-snug tracking-tight">{round.prompt}</h2>
              <div className="mt-8 grid gap-3">
                {round.choices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => answer(round.id, choice.id)}
                    className="min-h-[44px] rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-surface-raised)] px-4 py-3 text-left text-sm font-black transition active:scale-[.98] motion-reduce:transition-none"
                  >
                    {choice.text}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {status === "ready" && session?.phase === "feedback" && session.feedback ? (
            <section aria-live="polite" className="rounded-[28px] border border-[var(--wd-border)] bg-[var(--wd-surface)] p-7 text-center shadow-2xl">
              <p className="text-[11px] font-black tracking-[.16em] text-[var(--wd-accent)]">{session.feedback.correct ? "HIT" : "MISS"}</p>
              <h2 className="mt-3 text-2xl font-black">{session.feedback.correct ? "정확해!" : "이번 답은 이거야"}</h2>
              <p className="mt-5 rounded-2xl bg-[var(--wd-surface-raised)] px-4 py-4 text-lg font-black">{session.feedback.answer}</p>
              <p className="mt-4 text-sm font-bold text-[var(--wd-muted)]">{resultLine}</p>
              <button type="button" onClick={continueDrill} className="mt-7 min-h-[44px] w-full rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black text-[var(--wd-bg)] transition active:scale-[.98] motion-reduce:transition-none">
                {session.roundIndex + 1 === WINDDOWN_DRILL_ROUND_TARGET ? "결과 보기" : "다음 라운드"}
              </button>
            </section>
          ) : null}

          {status === "ready" && session?.phase === "complete" ? (
            <section className="rounded-[28px] border border-[var(--wd-border)] bg-[var(--wd-surface)] p-7 text-center shadow-2xl">
              <p className="text-[11px] font-black tracking-[.16em] text-[var(--wd-accent)]">DRILL COMPLETE</p>
              <h2 className="mt-3 text-3xl font-black tabular-nums">{session.score}점</h2>
              <p className="mt-3 text-sm font-bold text-[var(--wd-muted)]">정답 {session.correctCount}/{WINDDOWN_DRILL_ROUND_TARGET} · 최고 콤보 {session.maxCombo}</p>
              <button type="button" onClick={replay} className="mt-7 min-h-[44px] w-full rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black text-[var(--wd-bg)] transition active:scale-[.98] motion-reduce:transition-none">
                같은 보드 다시 하기
              </button>
              <Link href="/winddown" className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl border border-[var(--wd-border)] px-5 text-sm font-black">
                오늘 밤으로
              </Link>
            </section>
          ) : null}
        </main>

        <p className="pb-1 text-center text-[11px] font-bold leading-5 text-[var(--wd-muted)]">
          연습 전용 · 점수와 콤보는 이 화면에만 남고, 학습 기록·복습 간격·퀘스트는 바꾸지 않아.
        </p>
      </div>
    </div>
  );
}
