"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  WindDownLumi,
  type WindDownLumiState,
} from "@/features/winddown/ui/WindDownLumi";

type Activity = "learn" | "review" | "roleplay" | "live-talk";
type NavigationActivity = Activity | "drill";

type ConstellationDay = {
  kstDay: string;
  completed: boolean;
  activities: Activity[];
};

type QuestHistoryItem = {
  activity: Activity;
  kstDay: string;
};

type HabitProjection = {
  currentKstDay: string;
  streak: { nights: number };
  constellation: ConstellationDay[];
  questHistory: QuestHistoryItem[];
};

type TonightJourney = {
  completed: boolean;
  nextAction: "review" | "learn" | "roleplay" | "free";
  learnCreditedCount: number;
  learnTarget: number;
  reviewCompletedCount: number;
  reviewTarget: number;
  voiceCompleted: boolean;
  estimatedMinutes: number;
};

type HabitResponse = {
  projection: HabitProjection;
  tonight: TonightJourney;
  game: {
    schemaVersion: 1;
    xp: number;
    creditedAnswerCount: number;
    collectedReviewStarCount: number;
    creditedNightCount: number;
  };
};

const ACTIVITIES: Array<{
  id: NavigationActivity;
  href: string;
  label: string;
  description: string;
}> = [
  {
    id: "learn",
    href: "/winddown/learn",
    label: "Learn",
    description: "오늘의 다섯 문장",
  },
  {
    id: "review",
    href: "/winddown/review",
    label: "Review",
    description: "돌아볼 문장",
  },
  {
    id: "drill",
    href: "/winddown/drill",
    label: "Quick Drill",
    description: "점수와 콤보로 다섯 라운드",
  },
  {
    id: "roleplay",
    href: "/winddown/roleplay",
    label: "Roleplay",
    description: "짧은 장면 연습",
  },
  {
    id: "live-talk",
    href: "/winddown/live-talk",
    label: "Live Talk",
    description: "편안한 자유 대화",
  },
];

const activityLabel: Record<Activity, string> = {
  learn: "Learn",
  review: "Review",
  roleplay: "Roleplay",
  "live-talk": "Live Talk",
};

const nextActionDetails: Record<TonightJourney["nextAction"], { href: string; label: string; description: string }> = {
  review: {
    href: "/winddown/review",
    label: "복습 이어하기",
    description: "먼저 돌아볼 문장부터",
  },
  learn: {
    href: "/winddown/learn",
    label: "Learn 이어하기",
    description: "오늘의 다섯 문장을 채워요",
  },
  roleplay: {
    href: "/winddown/roleplay",
    label: "말하기 이어하기",
    description: "짧은 장면으로 오늘을 마무리해요",
  },
  free: {
    href: "/winddown/live-talk",
    label: "Live Talk 이어하기",
    description: "원한다면 편하게 더 말해도 돼요",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isActivity(value: unknown): value is Activity {
  return value === "learn" || value === "review" || value === "roleplay" || value === "live-talk";
}

function isConstellationDay(value: unknown): value is ConstellationDay {
  if (!isRecord(value) || typeof value.kstDay !== "string" || typeof value.completed !== "boolean") {
    return false;
  }
  return Array.isArray(value.activities) && value.activities.every(isActivity);
}

function isQuestHistoryItem(value: unknown): value is QuestHistoryItem {
  return isRecord(value) && typeof value.kstDay === "string" && isActivity(value.activity);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function projectionFrom(value: unknown): HabitResponse | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.projection)) return null;
  const projection = value.projection;
  if (
    typeof projection.currentKstDay !== "string" ||
    !isRecord(projection.streak) ||
    !isNonNegativeInteger(projection.streak.nights) ||
    !Array.isArray(projection.constellation) ||
    projection.constellation.length !== 7 ||
    !projection.constellation.every(isConstellationDay) ||
    !Array.isArray(projection.questHistory) ||
    !projection.questHistory.every(isQuestHistoryItem)
  ) {
    return null;
  }

  const tonight = value.tonight;
  if (
    !isRecord(tonight) ||
    typeof tonight.completed !== "boolean" ||
    !["review", "learn", "roleplay", "free"].includes(String(tonight.nextAction)) ||
    !isNonNegativeInteger(tonight.learnCreditedCount) ||
    !isNonNegativeInteger(tonight.learnTarget) ||
    !isNonNegativeInteger(tonight.reviewCompletedCount) ||
    !isNonNegativeInteger(tonight.reviewTarget) ||
    typeof tonight.voiceCompleted !== "boolean" ||
    !isNonNegativeInteger(tonight.estimatedMinutes)
  ) {
    return null;
  }
  const game = value.game;
  if (
    !isRecord(game) ||
    game.schemaVersion !== 1 ||
    !isNonNegativeInteger(game.xp) ||
    !isNonNegativeInteger(game.creditedAnswerCount) ||
    !isNonNegativeInteger(game.collectedReviewStarCount) ||
    !isNonNegativeInteger(game.creditedNightCount)
  ) {
    return null;
  }

  return {
    projection: {
      currentKstDay: projection.currentKstDay,
      streak: { nights: projection.streak.nights },
      constellation: projection.constellation,
      questHistory: projection.questHistory,
    },
    tonight: {
      completed: tonight.completed,
      nextAction: tonight.nextAction as TonightJourney["nextAction"],
      learnCreditedCount: tonight.learnCreditedCount,
      learnTarget: tonight.learnTarget,
      reviewCompletedCount: tonight.reviewCompletedCount,
      reviewTarget: tonight.reviewTarget,
      voiceCompleted: tonight.voiceCompleted,
      estimatedMinutes: tonight.estimatedMinutes,
    },
    game: {
      schemaVersion: 1,
      xp: game.xp,
      creditedAnswerCount: game.creditedAnswerCount,
      collectedReviewStarCount: game.collectedReviewStarCount,
      creditedNightCount: game.creditedNightCount,
    },
  };
}

function weekday(kstDay: string) {
  const date = new Date(`${kstDay}T00:00:00+09:00`);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date).replace("요일", "");
}

function monthDay(kstDay: string) {
  const date = new Date(`${kstDay}T00:00:00+09:00`);
  return Number.isNaN(date.getTime())
    ? kstDay
    : new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(date);
}

export default function WindDownHabitHomeClient() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [habit, setHabit] = useState<HabitResponse | null>(null);
  const requestSequence = useRef(0);

  const loadHabit = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setStatus("loading");

    try {
      const response = await fetch("/api/winddown/habit", { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      const nextHabit = projectionFrom(body);
      if (!response.ok || !nextHabit) throw new Error("winddown_habit_projection_invalid");
      if (requestSequence.current !== sequence) return;
      setHabit(nextHabit);
      setStatus("ready");
    } catch {
      if (requestSequence.current !== sequence) return;
      setHabit(null);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadHabit();
  }, [loadHabit]);

  const projection = habit?.projection ?? null;
  const tonight = habit?.tonight ?? null;
  const game = habit?.game ?? null;
  const latestHistory = projection?.questHistory.slice(0, 3) ?? [];
  const nextAction = tonight ? nextActionDetails[tonight.nextAction] : null;
  const lumiState: WindDownLumiState =
    status === "loading"
      ? "thinking"
      : status === "error"
        ? "rescue"
        : tonight?.completed
          ? "celebrate"
          : status === "ready" && tonight
            ? "prompt"
            : "idle";

  return (
    <main className="min-h-[100dvh] overflow-x-hidden bg-[var(--wd-bg)] text-[var(--wd-ink)]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-5 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),22px)]">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-black tracking-[0.18em] text-[var(--wd-accent)]">WIND DOWN</p>
            <h1 className="mt-1 text-[30px] font-semibold tracking-tight [font-family:var(--font-wd-serif),ui-serif,Georgia,serif]">
              오늘 밤의 영어
            </h1>
          </div>
          <span className="mt-1 shrink-0 rounded-full border border-[var(--wd-line)] bg-[var(--wd-card)] px-3 py-2 text-xs font-bold text-[var(--wd-accent)]">
            {status === "ready" && projection ? monthDay(projection.currentKstDay) : "불러오는 중"}
          </span>
        </header>
        <WindDownLumi state={lumiState} compact className="mt-6" />

        {status === "loading" ? (
          <section aria-busy="true" aria-live="polite" className="mt-8 rounded-[28px] border border-[var(--wd-line)] bg-[var(--wd-card)] p-6 shadow-[var(--wd-shadow)]">
            <p className="text-lg font-bold">오늘의 기록을 불러오는 중</p>
            <p className="mt-2 text-sm leading-6 text-[var(--wd-muted)]">완료 기록을 확인한 뒤, 가장 알맞은 시작을 보여줄게.</p>
          </section>
        ) : null}

        {status === "error" ? (
          <section role="alert" className="mt-8 rounded-[28px] border border-[var(--wd-apricot)] bg-[var(--wd-apricot-soft)] p-6">
            <p className="text-lg font-bold">오늘의 기록을 열지 못했어.</p>
            <p className="mt-2 text-sm leading-6 text-[var(--wd-muted)]">완료 여부를 추측하지 않았어. 다시 확인해 줘.</p>
            <button
              type="button"
              onClick={() => void loadHabit()}
              className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black text-[var(--wd-bg)] transition active:scale-[.98] motion-reduce:transition-none"
            >
              다시 불러오기
            </button>
          </section>
        ) : null}

        {status === "ready" && projection && tonight && game && nextAction ? (
          <>
            <section className="mt-7 rounded-[30px] border border-[var(--wd-line)] bg-[var(--wd-card)] p-6 shadow-[var(--wd-shadow)]">
              <div className="flex items-start justify-between gap-4">
                <p className="text-[11px] font-black tracking-[0.16em] text-[var(--wd-accent)]">TONIGHT JOURNEY</p>
                <span className="shrink-0 text-xs font-semibold text-[var(--wd-muted)]">약 {tonight.estimatedMinutes}분</span>
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight [font-family:var(--font-wd-serif),ui-serif,Georgia,serif]">
                {tonight.completed ? "오늘 밤, 잘 마무리했어" : "지금 할 한 가지"}
              </h2>
              <p className="mt-3 text-sm font-medium leading-6 text-[var(--wd-muted)]">
                {tonight.completed ? "오늘 여정은 완료됐어. 원한다면 편하게 더 말해도 돼." : nextAction.description}
              </p>
              <Link
                href={nextAction.href}
                className="mt-5 inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black text-[var(--wd-bg)] transition active:scale-[.98] motion-reduce:transition-none"
              >
                {nextAction.label}
              </Link>
              <div className="mt-5 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5" aria-label="오늘 여정 진행 상태">
                <div className="min-w-0 rounded-2xl bg-[var(--wd-bg)] px-2 py-3 text-center">
                  <span className="block text-[10px] font-black tracking-[0.08em] text-[var(--wd-muted)]">복습</span>
                  <span className="mt-1 block text-sm font-black tabular-nums">{tonight.reviewCompletedCount}/{tonight.reviewTarget}</span>
                </div>
                <span aria-hidden className="text-[var(--wd-muted)]">→</span>
                <div className="min-w-0 rounded-2xl bg-[var(--wd-bg)] px-2 py-3 text-center">
                  <span className="block text-[10px] font-black tracking-[0.08em] text-[var(--wd-muted)]">LEARN</span>
                  <span className="mt-1 block text-sm font-black tabular-nums">{tonight.learnCreditedCount}/{tonight.learnTarget}</span>
                </div>
                <span aria-hidden className="text-[var(--wd-muted)]">→</span>
                <div className="min-w-0 rounded-2xl bg-[var(--wd-bg)] px-2 py-3 text-center">
                  <span className="block text-[10px] font-black tracking-[0.08em] text-[var(--wd-muted)]">말하기</span>
                  <span className="mt-1 block text-sm font-black tabular-nums">{tonight.voiceCompleted ? "1/1" : "0/1"}</span>
                </div>
              </div>
            </section>

            <section className="mt-5 rounded-[28px] border border-[var(--wd-line)] bg-[var(--wd-card-solid)] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black tracking-[0.16em] text-[var(--wd-accent)]">WORLD TOUR</p>
                  <h2 className="mt-1 text-lg font-bold">공부한 만큼 열린 무대</h2>
                </div>
                <Link href="/winddown/game" className="inline-flex min-h-[48px] shrink-0 items-center rounded-full border border-[var(--wd-accent)] px-4 text-sm font-black text-[var(--wd-accent)] transition active:scale-[.98] motion-reduce:transition-none">
                  투어 보기
                </Link>
              </div>
              <p className="mt-2 text-sm font-medium leading-6 text-[var(--wd-muted)]">
                저장된 문장 {game.creditedAnswerCount}개와 복습 별 {game.collectedReviewStarCount}개가 {game.xp} XP로 이어졌어.
              </p>
            </section>

            <section className="mt-5 rounded-[28px] border border-[var(--wd-line)] bg-[var(--wd-card-solid)] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black tracking-[0.16em] text-[var(--wd-accent)]">OPTIONAL</p>
                  <h2 className="mt-1 text-lg font-bold">Live Talk</h2>
                </div>
                <Link href="/winddown/live-talk" className="inline-flex min-h-[48px] shrink-0 items-center rounded-full border border-[var(--wd-accent)] px-4 text-sm font-black text-[var(--wd-accent)] transition active:scale-[.98] motion-reduce:transition-none">
                  편하게 말하기
                </Link>
              </div>
              <p className="mt-2 text-sm font-medium leading-6 text-[var(--wd-muted)]">완료와 상관없이, 점수 없이 오늘을 영어로 말할 수 있어.</p>
            </section>

            <section className="mt-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-bold">다른 방식으로 열기</h2>
                <span className="text-xs font-semibold text-[var(--wd-muted)]">언제든 선택 가능</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {ACTIVITIES.filter((activity) => activity.id !== "live-talk").map((activity) => {
                  const active = activity.href === nextAction.href;
                  return (
                    <Link
                      key={activity.id}
                      href={activity.href}
                      className={`min-h-[96px] rounded-3xl border p-4 transition active:scale-[.98] motion-reduce:transition-none ${active ? "border-[var(--wd-accent)] bg-[var(--wd-accent-soft)]" : "border-[var(--wd-line)] bg-[var(--wd-card)]"}`}
                    >
                      <span className="block text-base font-black">{activity.label}</span>
                      <span className="mt-2 block text-xs font-semibold leading-5 text-[var(--wd-muted)]">{activity.description}</span>
                    </Link>
                  );
                })}
              </div>
            </section>

            <section className="mt-6 rounded-[28px] border border-[var(--wd-line)] bg-[var(--wd-card-solid)] p-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-black tracking-[0.16em] text-[var(--wd-accent)]">7 NIGHTS</p>
                  <h2 className="mt-1 text-lg font-bold">{projection.streak.nights}일 연속</h2>
                </div>
                <p className="text-xs font-semibold text-[var(--wd-muted)]">완료한 밤만 채워져</p>
              </div>
              <ol className="mt-5 grid grid-cols-7 gap-1.5" aria-label="최근 7일 완료 기록">
                {projection.constellation.map((day) => {
                  const isToday = day.kstDay === projection.currentKstDay;
                  const label = `${monthDay(day.kstDay)} ${weekday(day.kstDay)}${isToday ? ", 오늘" : ""}: ${day.completed ? `${day.activities.map((activity) => activityLabel[activity]).join(", ")} 완료` : "미완료"}`;
                  return (
                    <li key={day.kstDay} className="min-w-0 text-center">
                      <span className="block text-[10px] font-bold text-[var(--wd-muted)]">{weekday(day.kstDay)}</span>
                      <span
                        aria-label={label}
                        className={`mx-auto mt-2 flex h-9 w-9 items-center justify-center rounded-full border text-xs font-black ${day.completed ? "border-[var(--wd-accent)] bg-[var(--wd-accent)] text-[var(--wd-bg)]" : "border-[var(--wd-line)] bg-[var(--wd-card)] text-[var(--wd-muted)]"} ${isToday ? "ring-2 ring-[var(--wd-accent-2)] ring-offset-2 ring-offset-[var(--wd-card-solid)]" : ""}`}
                      >
                        {day.completed ? "완료" : monthDay(day.kstDay).replace(/\D/g, "").slice(-2)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>

            {latestHistory.length > 0 ? (
              <section className="mt-6 border-t border-[var(--wd-line)] pt-5">
                <h2 className="text-sm font-bold">최근 완료</h2>
                <ul className="mt-3 space-y-2">
                  {latestHistory.map((item, index) => (
                    <li key={`${item.kstDay}:${item.activity}:${index}`} className="flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-[var(--wd-card)] px-4 text-sm">
                      <span className="font-bold">{activityLabel[item.activity]}</span>
                      <span className="shrink-0 text-xs font-semibold text-[var(--wd-muted)]">{monthDay(item.kstDay)} 완료</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
