"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WindDownChapter } from "@/features/winddown/game/model/tour";
import {
  chapterGrowth,
  currentChapter,
  isChapterUnlocked,
  levelFromXp,
  nextChapter,
  nightsToReach,
  xpIntoLevel,
  xpNeededForLevel,
} from "@/features/winddown/game/model/progress";
import { SCENE_PAINTERS, paintScene } from "@/features/winddown/game/ui/scenes";
import {
  DEFAULT_LEARNER,
  WIND_DOWN_CONTENT_PACK,
  isContentPackValid,
  memberForChapter,
  type WindDownLearnerProfile,
} from "@/features/winddown/game/model/contract";
import {
  normalizeWindDownCeremonyProjection,
  type WindDownCeremonyProjection,
  type WindDownCeremonySlotId,
} from "@/features/winddown/game/model/ceremony";

type Props = {
  /** Identity is presentation-only here; progress always comes from receipts. */
  learner?: WindDownLearnerProfile;
};

type GameProgress = {
  schemaVersion: 1;
  xp: number;
  creditedAnswerCount: number;
  collectedReviewStarCount: number;
  creditedNightCount: number;
};

type NextAction = "review" | "learn" | "roleplay" | "free";

type GameHabitResponse = {
  game: GameProgress;
  ceremony: WindDownCeremonyProjection;
  nextAction: NextAction;
};

const ACTIONS: Record<NextAction, { href: string; label: string }> = {
  review: { href: "/winddown/review", label: "복습 이어하기" },
  learn: { href: "/winddown/learn", label: "Learn 이어하기" },
  roleplay: { href: "/winddown/roleplay", label: "말하기 이어하기" },
  free: { href: "/winddown/live-talk", label: "오늘 더 말하기" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function gameHabitFrom(value: unknown): GameHabitResponse | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.game)) return null;
  const game = value.game;
  const ceremony = normalizeWindDownCeremonyProjection(value.ceremony);
  const tonight = value.tonight;
  if (
    game.schemaVersion !== 1
    || !isNonNegativeInteger(game.xp)
    || !isNonNegativeInteger(game.creditedAnswerCount)
    || !isNonNegativeInteger(game.collectedReviewStarCount)
    || !isNonNegativeInteger(game.creditedNightCount)
    || !ceremony
    || !isRecord(tonight)
    || !["review", "learn", "roleplay", "free"].includes(String(tonight.nextAction))
  ) {
    return null;
  }
  return {
    game: {
      schemaVersion: 1,
      xp: game.xp,
      creditedAnswerCount: game.creditedAnswerCount,
      collectedReviewStarCount: game.collectedReviewStarCount,
      creditedNightCount: game.creditedNightCount,
    },
    ceremony,
    nextAction: tonight.nextAction as NextAction,
  };
}

function ceremonyFrom(value: unknown): WindDownCeremonyProjection | null {
  return isRecord(value) && value.ok === true
    ? normalizeWindDownCeremonyProjection(value.ceremony)
    : null;
}

export default function WindDownGameClient({
  learner = DEFAULT_LEARNER,
}: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [habit, setHabit] = useState<GameHabitResponse | null>(null);
  const requestSequence = useRef(0);
  const ceremonyRequestPending = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [reduced, setReduced] = useState(false);
  const [selected, setSelected] = useState<WindDownChapter | null>(null);
  const [ceremonyStatus, setCeremonyStatus] = useState<
    "idle" | "saving" | "conflict" | "refreshed" | "error"
  >("idle");

  const xp = habit?.game.xp ?? 0;
  const level = levelFromXp(xp);
  const here = useMemo(() => currentChapter(xp), [xp]);
  const next = useMemo(() => nextChapter(xp), [xp]);
  const growth = useMemo(() => chapterGrowth(xp), [xp]);
  const chapter = selected ?? here;
  const member = useMemo(
    () => memberForChapter(WIND_DOWN_CONTENT_PACK, learner, chapter.id),
    [chapter.id, learner],
  );

  const loadProgress = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setStatus("loading");
    try {
      const response = await fetch("/api/winddown/habit", { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      const nextHabit = gameHabitFrom(body);
      if (!response.ok || !nextHabit) {
        throw new Error("winddown_game_progress_invalid");
      }
      if (requestSequence.current !== sequence) return;
      setHabit(nextHabit);
      setStatus("ready");
    } catch {
      if (requestSequence.current !== sequence) return;
      setHabit(null);
      setStatus("error");
    }
  }, []);

  const commitCeremony = useCallback(async (
    slotId: WindDownCeremonySlotId,
    optionId: string,
  ) => {
    if (ceremonyRequestPending.current) return;
    ceremonyRequestPending.current = true;
    setCeremonyStatus("saving");
    try {
      const response = await fetch("/api/winddown/game/ceremony", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId, optionId }),
      });
      const body: unknown = await response.json().catch(() => null);
      const ceremony = ceremonyFrom(body);
      if (response.status === 409) {
        const errorCode = isRecord(body) && typeof body.error === "string"
          ? body.error
          : "";
        const latestResponse = await fetch("/api/winddown/habit", {
          cache: "no-store",
        });
        const latestBody: unknown = await latestResponse.json().catch(() => null);
        const latestHabit = gameHabitFrom(latestBody);
        if (!latestResponse.ok || !latestHabit) {
          throw new Error("winddown_ceremony_conflict_refresh_failed");
        }
        setHabit(latestHabit);
        setCeremonyStatus(
          errorCode === "WINDDOWN_CEREMONY_CHOICE_CONFLICT"
            ? "conflict"
            : "refreshed",
        );
        return;
      }
      if (!response.ok || !ceremony) {
        throw new Error("winddown_ceremony_commit_failed");
      }
      setHabit((current) => current ? { ...current, ceremony } : current);
      setCeremonyStatus("idle");
    } catch {
      setCeremonyStatus("error");
    } finally {
      ceremonyRequestPending.current = false;
    }
  }, []);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const paint = useCallback(
    (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      paintScene(context, {
        scene: chapter.scene,
        width,
        height,
        time,
        growth: chapter.id === here.id ? growth : 1,
        member,
      });
    },
    [chapter, growth, here.id, member],
  );

  useEffect(() => {
    if (!reduced || status !== "ready") return undefined;
    paint(0);
    const repaint = () => paint(0);
    window.addEventListener("resize", repaint);
    window.addEventListener("orientationchange", repaint);
    return () => {
      window.removeEventListener("resize", repaint);
      window.removeEventListener("orientationchange", repaint);
    };
  }, [paint, reduced, status]);

  useEffect(() => {
    if (reduced || status !== "ready") return undefined;
    const loop = (time: number) => {
      paint(time);
      frameRef.current = window.requestAnimationFrame(loop);
    };
    frameRef.current = window.requestAnimationFrame(loop);
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [paint, reduced, status]);

  const forecast = next ? nightsToReach(next.unlockLevel, xp) : 0;
  const action = habit ? ACTIONS[habit.nextAction] : null;
  const chosenCeremonies = habit?.ceremony.slots.filter(
    (slot) => slot.choice !== null,
  ) ?? [];
  const openCeremony = habit?.ceremony.slots.find(
    (slot) => slot.unlocked && slot.choice === null,
  ) ?? null;
  const nextCeremony = habit?.ceremony.slots.find(
    (slot) => !slot.unlocked,
  ) ?? null;
  const ceremonyUnavailable = habit?.ceremony.status === "unavailable";

  if (!isContentPackValid(WIND_DOWN_CONTENT_PACK)) {
    return (
      <main role="alert" className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-5 pt-[max(env(safe-area-inset-top),20px)] text-[var(--wd-text)]">
        <h1 className="mt-16 text-xl font-bold">투어 콘텐츠를 안전하게 열지 못했어.</h1>
        <Link href="/winddown" className="mt-5 inline-flex min-h-12 items-center text-sm font-black text-[var(--wd-accent)]">
          오늘 밤으로 돌아가기
        </Link>
      </main>
    );
  }

  if (status === "loading" || !habit || !action) {
    return (
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col px-5 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),20px)] text-[var(--wd-text)]">
        <Link href="/winddown" className="inline-flex min-h-12 items-center text-sm font-black text-[var(--wd-accent)]">
          ← 오늘 밤으로
        </Link>
        {status === "loading" ? (
          <section aria-busy="true" aria-live="polite" className="mt-8 rounded-[24px] border border-[var(--wd-border)] p-6" style={{ background: "var(--wd-surface)" }}>
            <h1 className="text-xl font-bold">학습 기록으로 투어를 여는 중</h1>
            <p className="mt-2 text-sm text-[var(--wd-text-muted)]">저장된 완료 기록만 확인하고 있어.</p>
          </section>
        ) : (
          <section role="alert" className="mt-8 rounded-[24px] border border-[var(--wd-border)] p-6" style={{ background: "var(--wd-surface)" }}>
            <h1 className="text-xl font-bold">투어 기록을 열지 못했어.</h1>
            <p className="mt-2 text-sm text-[var(--wd-text-muted)]">경험치를 추측하지 않았어. 다시 확인해 줘.</p>
            <button
              type="button"
              onClick={() => void loadProgress()}
              className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[var(--wd-accent)] px-5 text-sm font-black text-[var(--wd-bg)]"
            >
              다시 불러오기
            </button>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col gap-4 px-5 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),20px)] text-[var(--wd-text)]">
      <nav aria-label="월드 투어 이동" className="flex items-center justify-between gap-3">
        <Link href="/winddown" className="inline-flex min-h-12 items-center text-sm font-black text-[var(--wd-accent)]">
          ← 오늘 밤
        </Link>
        <Link href={action.href} className="inline-flex min-h-12 items-center rounded-2xl bg-[var(--wd-accent)] px-4 text-sm font-black text-[var(--wd-bg)]">
          {action.label}
        </Link>
      </nav>
      <header>
        <p className="text-[11px] font-black tracking-[0.18em] text-[var(--wd-accent)]">
          {WIND_DOWN_CONTENT_PACK.acts.find((act) => act.id === chapter.act)?.tag ?? "ACT"} ·{" "}
          {WIND_DOWN_CONTENT_PACK.acts.find((act) => act.id === chapter.act)?.name ?? ""}
        </p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight">{chapter.label}</h1>
        <p className="mt-2 text-sm font-medium text-[var(--wd-text-muted)]">
          {chapter.country} · {chapter.beat}
        </p>
      </header>

      <section
        className="overflow-hidden rounded-[24px] border border-[var(--wd-border)]"
        style={{ background: "var(--wd-surface)" }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          className="block h-[196px] w-full"
          aria-label={`${chapter.label} 무대에서 ${member.name}와 함께 걷는 장면. ${chapter.beat}`}
        >
          {`${chapter.label} · ${chapter.country}. ${chapter.beat}`}
        </canvas>
      </section>

      <section className="rounded-[24px] border border-[var(--wd-border)] p-5" style={{ background: "var(--wd-surface)" }}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-black tracking-[0.16em] text-[var(--wd-accent)]">TOUR PROGRESS</p>
          <span className="text-xs font-bold text-[var(--wd-text-muted)]">Lv.{level}</span>
        </div>
        <div className="mt-3 h-[7px] overflow-hidden rounded-full" style={{ background: "var(--wd-border)" }}>
          <i
            className="block h-full rounded-full"
            style={{
              width: `${Math.round((xpIntoLevel(xp) / xpNeededForLevel(xp)) * 100)}%`,
              background: "var(--wd-accent)",
            }}
          />
        </div>
        <p className="mt-2 text-xs font-bold text-[var(--wd-text-muted)]">
          {next
            ? `${next.label} 개방까지 Lv.${next.unlockLevel} · 매일 19 XP면 약 ${forecast}일`
            : "마지막 장까지 열었어."}
        </p>
        <p className="mt-1 text-xs font-bold text-[var(--wd-text-muted)]">
          {here.label} 성장 {Math.round(growth * 100)}% · 저장된 학습 기록이 쌓일 때 자라
        </p>
        <p className="mt-1 text-xs font-bold text-[var(--wd-text-muted)]">
          저장된 문장 {habit.game.creditedAnswerCount}개 · 복습 별 {habit.game.collectedReviewStarCount}개 · {habit.game.creditedNightCount}밤
        </p>
      </section>

      <section aria-label="챕터 목록">
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {WIND_DOWN_CONTENT_PACK.chapters.map((item) => {
            const open = isChapterUnlocked(item, xp);
            return (
              <li key={item.id} className="shrink-0">
                <button
                  type="button"
                  disabled={!open}
                  aria-pressed={item.id === chapter.id}
                  onClick={() => setSelected(item)}
                  className="flex min-h-[76px] w-[104px] flex-col justify-between rounded-[18px] border p-3 text-left disabled:opacity-40"
                  style={{
                    borderColor: item.id === chapter.id ? "var(--wd-accent)" : "var(--wd-border)",
                    background: "var(--wd-surface)",
                  }}
                >
                  <span className="text-[13px] font-black">{item.label}</span>
                  <span className="text-[10px] font-bold tracking-[0.1em] text-[var(--wd-text-muted)]">
                    {open ? item.country : `Lv.${item.unlockLevel}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-label="우리의 이름"
        className="rounded-[24px] border border-[var(--wd-border)] p-5"
        style={{ background: "var(--wd-surface)" }}
      >
        <p className="text-[11px] font-black tracking-[0.16em] text-[var(--wd-accent)]">OUR STORY</p>
        {chosenCeremonies.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {chosenCeremonies.map((slot) => (
              <li
                key={slot.id}
                className="rounded-full border border-[var(--wd-border)] px-3 py-2 text-xs font-black"
              >
                {slot.label} · {slot.choice?.label}
              </li>
            ))}
          </ul>
        ) : null}
        {ceremonyUnavailable ? (
          <div className={chosenCeremonies.length > 0 ? "mt-5" : "mt-2"}>
            <h2 className="text-lg font-bold">이름 후보를 지금 불러오지 못했어.</h2>
            <p className="mt-2 text-sm font-medium text-[var(--wd-text-muted)]">
              학습과 투어 기록은 그대로야. 출판된 문장 자료가 다시 열리면 여기서 이어갈 수 있어.
            </p>
          </div>
        ) : openCeremony ? (
          <div className={chosenCeremonies.length > 0 ? "mt-5" : "mt-2"}>
            <p className="text-xs font-black text-[var(--wd-accent)]">
              학습 기록이 Lv.{openCeremony.unlockLevel}을 열었어
            </p>
            <h2 className="mt-1 text-lg font-bold">{openCeremony.label}을 정할 순간</h2>
            <p className="mt-2 text-sm font-medium text-[var(--wd-text-muted)]">
              {openCeremony.optionSource === "mastery-derived"
                ? "모나가 복습에서 정확히 떠올린 문장으로 만든 후보야. 한 번 정하면 공식 이름으로 남아."
                : "아직 후보로 만들 숙달 문장이 부족해 첫 이름 후보를 준비했어. 한 번 정하면 공식 이름으로 남아."}
            </p>
            <div className="mt-4 grid gap-2">
              {openCeremony.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={ceremonyStatus === "saving"}
                  onClick={() => void commitCeremony(openCeremony.id, option.id)}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-[var(--wd-border)] px-4 text-sm font-black disabled:opacity-50"
                  style={{ background: "var(--wd-bg)" }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p aria-live="polite" className="mt-3 min-h-5 text-xs font-bold text-[var(--wd-text-muted)]">
              {ceremonyStatus === "saving"
                ? "공식 이름으로 저장하는 중…"
                : ceremonyStatus === "conflict"
                  ? "다른 화면에서 먼저 정한 공식 이름을 불러왔어."
                : ceremonyStatus === "refreshed"
                  ? "문장 자료가 갱신되어 최신 이름 후보를 불러왔어."
                : ceremonyStatus === "error"
                  ? "이름을 저장하지 못했어. 연결을 확인하고 다시 눌러 줘."
                  : ""}
            </p>
          </div>
        ) : nextCeremony ? (
          <p className="mt-3 text-sm font-bold text-[var(--wd-text-muted)]">
            다음 이야기 · {nextCeremony.label}은 Lv.{nextCeremony.unlockLevel}에 열려.
          </p>
        ) : (
          <p className="mt-3 text-sm font-bold text-[var(--wd-text-muted)]">
            우리 팀의 공식 이야기가 모두 정해졌어.
          </p>
        )}
      </section>

      <section aria-label="함께 걷는 멤버" className="rounded-[24px] border border-[var(--wd-border)] p-5" style={{ background: "var(--wd-surface)" }}>
        <p className="text-[11px] font-black tracking-[0.16em] text-[var(--wd-accent)]">COMPANION</p>
        <h2 className="mt-1 text-lg font-bold">{member.name} · {member.roleLabel}</h2>
        <p className="mt-2 text-sm font-medium text-[var(--wd-text-muted)]">{member.voice.greet}</p>
        <p className="mt-3 text-xs font-bold text-[var(--wd-text-muted)]">
          모나의 고정 시드로 네 멤버가 장면마다 번갈아 안내해.
        </p>
      </section>

      <p className="pb-2 text-center text-[11px] font-bold text-[var(--wd-text-muted)]">
        공부해서 얻은 경험치로만 나아가. 시간 제한도 실패도 없어. 장면 {Object.keys(SCENE_PAINTERS).length}종 ·
        콘텐츠 {WIND_DOWN_CONTENT_PACK.id} {WIND_DOWN_CONTENT_PACK.version} · {learner.name}
      </p>
    </main>
  );
}
