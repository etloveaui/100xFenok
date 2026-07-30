"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Image from "next/image";
import { AnimatePresence, domAnimation, LazyMotion, m, useReducedMotion } from "motion/react";
import type { MonaVnextAnswerMatchTier } from "@/features/mona-vnext/coach/answerMatcher";
import type { ProductQuestState } from "@/features/mona-vnext/product/gameSession";
import type { ExpressionCard } from "@/components/admin-live/AdminLiveBench";

export type WindDownPhase = "boot" | "ready" | "connecting" | "live" | "stopped" | "blocked";

type WindDownTheme = "light" | "dark";

type AnswerVerdict = {
  tier: MonaVnextAnswerMatchTier;
  symbol: string;
  label: string;
  detail: string;
};

type Props = {
  phase: WindDownPhase;
  message: string;
  card: ExpressionCard | null;
  coachLine: string | null;
  errorText: string | null;
  answerVisible?: boolean;
  answerVerdict?: AnswerVerdict | null;
  quest?: ProductQuestState;
  voiceName: string;
  vadPreset: string;
  onVoiceChange: (voice: string) => void;
  onVadChange: (preset: "relaxed" | "balanced") => void;
  settingsSlot?: ReactNode;
  resumeOffer?: boolean;
  onStart: () => void;
  onStop: () => void;
  onResume?: () => void;
  onRevealAnswer?: () => void;
  onNext?: () => void;
};

const THEME_STORAGE_KEY = "winddown-theme";
const VOICE_STORAGE_KEY = "winddown-voice";
const VAD_STORAGE_KEY = "winddown-vad";
const EMPTY_QUEST: ProductQuestState = {
  targetSteps: 5,
  completedSteps: 0,
  xp: 0,
  lastReward: null,
  isComplete: false,
};

const VOICE_CHOICES = [
  { id: "Achernar", label: "포근하게", hint: "기본" },
  { id: "Aoede", label: "가볍게", hint: "산뜻" },
  { id: "Kore", label: "차분하게", hint: "또렷" },
];

const WAIT_CHOICES: Array<{ id: "relaxed" | "balanced"; label: string; hint: string }> = [
  { id: "relaxed", label: "여유 있게", hint: "생각할 틈" },
  { id: "balanced", label: "보통", hint: "조금 빠르게" },
];

const WEEKDAY_PLAN: Record<number, { day: string; theme: string }> = {
  0: { day: "일요일", theme: "주간 복습" },
  1: { day: "월요일", theme: "회사 · 업무" },
  2: { day: "화요일", theme: "가족 · 친구" },
  3: { day: "수요일", theme: "감정 · 혼잣말" },
  4: { day: "목요일", theme: "외출 · 식당" },
  5: { day: "금요일", theme: "업무 심화" },
  6: { day: "토요일", theme: "자유 주제" },
};

const PALETTES: Record<WindDownTheme, Record<string, string>> = {
  light: {
    "--wd-bg": "#f7f2ff",
    "--wd-wash": "radial-gradient(100% 70% at 12% 0%, rgba(255,199,153,.6), transparent 52%), radial-gradient(85% 65% at 100% 15%, rgba(182,159,255,.58), transparent 58%)",
    "--wd-ink": "#2b2340",
    "--wd-muted": "#756d88",
    "--wd-card": "rgba(255,255,255,.82)",
    "--wd-card-solid": "#fffdfd",
    "--wd-line": "rgba(87,67,124,.13)",
    "--wd-accent": "#7257c7",
    "--wd-accent-2": "#a66ced",
    "--wd-accent-soft": "#eee8ff",
    "--wd-apricot": "#d56c37",
    "--wd-apricot-soft": "#fff0e5",
    "--wd-shadow": "0 24px 64px -28px rgba(72,45,126,.42)",
  },
  dark: {
    "--wd-bg": "#120f21",
    "--wd-wash": "radial-gradient(95% 70% at 10% 0%, rgba(116,75,165,.48), transparent 56%), radial-gradient(95% 75% at 100% 10%, rgba(234,135,96,.24), transparent 60%)",
    "--wd-ink": "#f8f3ff",
    "--wd-muted": "#aaa0bd",
    "--wd-card": "rgba(39,31,58,.78)",
    "--wd-card-solid": "#241d36",
    "--wd-line": "rgba(232,220,255,.12)",
    "--wd-accent": "#ae91ff",
    "--wd-accent-2": "#d39eff",
    "--wd-accent-soft": "rgba(165,130,255,.15)",
    "--wd-apricot": "#ffad75",
    "--wd-apricot-soft": "rgba(255,161,103,.14)",
    "--wd-shadow": "0 28px 72px -28px rgba(0,0,0,.72)",
  },
};

const CARD_STATE_LABEL: Record<ExpressionCard["state"], string> = {
  prompt: "내 영어로 말하기",
  reveal: "자연스러운 표현",
  drill: "한 번 더",
};

const VERDICT_STYLE: Record<MonaVnextAnswerMatchTier, { emoji: string; label: string; color: string; bg: string }> = {
  canonical: { emoji: "✨", label: "정확해!", color: "#2d8d62", bg: "rgba(77,203,139,.16)" },
  variant: { emoji: "🌟", label: "이 표현도 좋아!", color: "#6e55c6", bg: "rgba(162,130,255,.17)" },
  close: { emoji: "🔥", label: "거의 다 왔어!", color: "#c56d28", bg: "rgba(255,161,80,.17)" },
  miss: { emoji: "🌱", label: "좋아, 같이 고쳐보자", color: "#567194", bg: "rgba(111,155,210,.16)" },
  garbage: { emoji: "🎙️", label: "잘 못 들었어", color: "#787184", bg: "rgba(140,132,152,.14)" },
};

function studyPlanLine(): string {
  const shifted = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const plan = WEEKDAY_PLAN[shifted.getDay()];
  return `${plan.day} · ${plan.theme}`;
}

function createAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return AudioContextClass ? new AudioContextClass() : null;
}

function playVerdictChime(context: AudioContext, tier: MonaVnextAnswerMatchTier) {
  if (tier === "garbage" || context.state !== "running") return;
  const now = context.currentTime;
  const notes = tier === "miss" ? [220] : tier === "close" ? [523.25, 587.33] : [523.25, 659.25];

  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startsAt = now + index * 0.09;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, startsAt);
    gain.gain.exponentialRampToValueAtTime(0.055, startsAt + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + 0.17);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startsAt);
    oscillator.stop(startsAt + 0.18);
  });
}

export default function MonaWindDown({
  phase,
  message,
  card,
  coachLine,
  errorText,
  answerVisible = false,
  answerVerdict = null,
  quest = EMPTY_QUEST,
  voiceName,
  vadPreset,
  onVoiceChange,
  onVadChange,
  settingsSlot,
  resumeOffer = false,
  onStart,
  onStop,
  onResume,
  onRevealAnswer,
  onNext,
}: Props) {
  const [theme, setTheme] = useState<WindDownTheme>(() => {
    if (typeof window === "undefined") return "dark";
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      return saved === "dark" || saved === "light" ? saved : "dark";
    } catch {
      return "dark";
    }
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const prefsAppliedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (prefsAppliedRef.current || phase === "boot") return;
    prefsAppliedRef.current = true;
    try {
      const savedVoice = window.localStorage.getItem(VOICE_STORAGE_KEY);
      if (savedVoice && VOICE_CHOICES.some((choice) => choice.id === savedVoice)) onVoiceChange(savedVoice);
      const savedVad = window.localStorage.getItem(VAD_STORAGE_KEY);
      if (savedVad === "relaxed" || savedVad === "balanced") onVadChange(savedVad);
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, [phase, onVadChange, onVoiceChange]);

  useEffect(() => {
    if (!answerVerdict) return;
    const context = audioContextRef.current;
    if (context) playVerdictChime(context, answerVerdict.tier);
  }, [answerVerdict, quest.completedSteps]);

  useEffect(() => () => {
    void audioContextRef.current?.close();
  }, []);

  const planLine = useMemo(() => studyPlanLine(), []);
  const live = phase === "live";
  const busy = phase === "connecting" || phase === "boot";
  const progress = Math.round((quest.completedSteps / quest.targetSteps) * 100);
  const verdictStyle = answerVerdict ? VERDICT_STYLE[answerVerdict.tier] : null;

  const pickVoice = (id: string) => {
    onVoiceChange(id);
    try {
      window.localStorage.setItem(VOICE_STORAGE_KEY, id);
    } catch {
      // Keep the in-memory setting.
    }
  };

  const pickWait = (id: "relaxed" | "balanced") => {
    onVadChange(id);
    try {
      window.localStorage.setItem(VAD_STORAGE_KEY, id);
    } catch {
      // Keep the in-memory setting.
    }
  };

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Keep the in-memory setting.
      }
      return next;
    });
  };

  const beginSession = () => {
    const context = audioContextRef.current ?? createAudioContext();
    audioContextRef.current = context;
    if (context?.state === "suspended") void context.resume();
    onStart();
  };

  const primaryLabel = phase === "connecting"
    ? "루미가 연결 중이야"
    : phase === "boot"
      ? "오늘 문장을 준비 중이야"
      : phase === "blocked"
        ? errorText?.includes("찾지 못했어")
          ? "마이크 연결을 확인해줘"
          : "마이크 권한을 확인해줘"
        : phase === "stopped"
          ? "새 퀘스트 시작"
          : "오늘의 5문장 시작";

  return (
    <LazyMotion features={domAnimation} strict>
      <div
        data-wd-theme={theme}
        style={PALETTES[theme] as React.CSSProperties}
        className="fixed inset-0 z-[70] flex min-h-[100dvh] flex-col overflow-hidden bg-[var(--wd-bg)] text-[var(--wd-ink)]"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "var(--wd-wash)" }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.055] wd-stars" />

        <header className="relative z-[1] px-5 pt-[max(env(safe-area-inset-top),16px)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black tracking-[0.23em] text-[var(--wd-accent)]">WIND DOWN</p>
              <p className="mt-1 text-[13px] font-semibold text-[var(--wd-muted)]">{planLine}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-full border border-[var(--wd-line)] bg-[var(--wd-card)] px-3 py-2 text-[12px] font-black backdrop-blur-xl">
                <span aria-hidden>✨</span> {quest.xp} XP
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label="설정 열기"
                className="flex h-[44px] w-[44px] items-center justify-center rounded-full border border-[var(--wd-line)] bg-[var(--wd-card)] backdrop-blur-xl transition active:scale-95"
              >
                <svg aria-hidden width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="4" y1="8" x2="20" y2="8" />
                  <circle cx="9" cy="8" r="2.5" fill="var(--wd-card-solid)" />
                  <line x1="4" y1="16" x2="20" y2="16" />
                  <circle cx="15" cy="16" r="2.5" fill="var(--wd-card-solid)" />
                </svg>
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--wd-line)]">
              <m.div
                className="h-full rounded-full bg-gradient-to-r from-[var(--wd-accent)] to-[var(--wd-apricot)]"
                initial={false}
                animate={{ width: `${progress}%` }}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 170, damping: 24 }}
              />
            </div>
            <span className="text-[12px] font-black tabular-nums text-[var(--wd-muted)]">
              {quest.completedSteps}/{quest.targetSteps}
            </span>
          </div>
        </header>

        <main className="relative z-[1] flex flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-4">
          {resumeOffer && onResume ? (
            <m.section
              initial={reduceMotion ? false : { opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 rounded-2xl border border-[var(--wd-accent)] bg-[var(--wd-accent-soft)] p-4 backdrop-blur-xl"
            >
              <p className="text-[14px] font-bold">하던 문장은 그대로 기억하고 있어.</p>
              <button
                type="button"
                onClick={onResume}
                className="mt-3 min-h-11 w-full rounded-xl bg-[var(--wd-accent)] px-4 text-[14px] font-black text-[#171021] transition active:scale-[.98]"
              >
                이어서 하기
              </button>
            </m.section>
          ) : null}

          <section className="mx-auto mt-2 flex w-full max-w-[460px] items-center justify-center gap-1">
            <m.div
              className="relative h-[134px] w-[142px] shrink-0"
              animate={reduceMotion ? undefined : live ? { y: [0, -5, 0], rotate: [-1.2, 1.2, -1.2] } : { y: [0, -3, 0] }}
              transition={reduceMotion ? undefined : { duration: live ? 2.6 : 4, repeat: Infinity, ease: "easeInOut" }}
            >
              <m.div
                aria-hidden
                className="absolute inset-[24px] rounded-full bg-[var(--wd-accent)] blur-2xl"
                animate={reduceMotion ? undefined : live ? { opacity: [0.22, 0.55, 0.22], scale: [0.9, 1.16, 0.9] } : { opacity: 0.16 }}
                transition={reduceMotion ? undefined : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              />
              {/* Generated specifically for WIND DOWN; no third-party character asset. */}
              <Image
                src="/winddown/lumi-mascot.webp"
                width={768}
                height={768}
                alt="달빛 영어 코치 루미"
                priority
                className="relative z-[1] h-full w-full object-contain drop-shadow-[0_18px_22px_rgba(0,0,0,.28)]"
              />
            </m.div>

            <div className="relative min-w-0 flex-1 rounded-3xl rounded-bl-md border border-[var(--wd-line)] bg-[var(--wd-card)] px-4 py-3 backdrop-blur-xl">
              <p className="text-[11px] font-black tracking-[.12em] text-[var(--wd-accent)]">
                {live ? "루미가 듣고 있어" : "오늘의 코치 · 루미"}
              </p>
              <p className="mt-1 line-clamp-3 text-[13px] font-semibold leading-relaxed text-[var(--wd-muted)]">
                {errorText ?? coachLine ?? message}
              </p>
              {live ? (
                <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--wd-apricot)]">
                  <span className="wd-listen-dot h-2 w-2 rounded-full bg-current" />
                  천천히 말해도 괜찮아
                </span>
              ) : null}
            </div>
          </section>

          <AnimatePresence mode="wait">
            {quest.isComplete ? (
              <m.section
                key="quest-complete"
                initial={reduceMotion ? false : { opacity: 0, scale: 0.94, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mx-auto w-full max-w-[460px] rounded-[30px] border border-[var(--wd-line)] bg-[var(--wd-card)] p-7 text-center backdrop-blur-xl"
                style={{ boxShadow: "var(--wd-shadow)" }}
              >
                <div className="text-5xl" aria-hidden>🌙</div>
                <p className="mt-4 text-[12px] font-black tracking-[.16em] text-[var(--wd-accent)]">QUEST COMPLETE</p>
                <h1 className="mt-2 text-[27px] font-black tracking-tight">오늘 5문장 완료!</h1>
                <p className="mt-2 text-[14px] font-semibold text-[var(--wd-muted)]">
                  짧게 끝냈지만, 오늘 영어는 분명히 쌓였어.
                </p>
                <div className="mx-auto mt-5 inline-flex rounded-full bg-[var(--wd-apricot-soft)] px-4 py-2 text-[14px] font-black text-[var(--wd-apricot)]">
                  +{quest.xp} XP
                </div>
                <button
                  type="button"
                  onClick={onStop}
                  className="mt-6 min-h-14 w-full rounded-2xl bg-gradient-to-r from-[var(--wd-accent)] to-[var(--wd-accent-2)] px-5 text-[15px] font-black text-[#171021] shadow-lg transition active:scale-[.98]"
                >
                  오늘은 여기까지
                </button>
              </m.section>
            ) : (
              <m.section
                key={card ? `card-${card.updatedAt}` : "welcome"}
                initial={reduceMotion ? false : { opacity: 0, y: 14, rotateX: -4 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
                aria-live="polite"
                className="mx-auto w-full max-w-[460px] rounded-[30px] border border-[var(--wd-line)] bg-[var(--wd-card)] p-6 backdrop-blur-xl"
                style={{ boxShadow: "var(--wd-shadow)", transformPerspective: 800 }}
              >
                {card ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full bg-[var(--wd-accent-soft)] px-3 py-1.5 text-[11px] font-black tracking-[.08em] text-[var(--wd-accent)]">
                        {CARD_STATE_LABEL[card.state]}
                      </span>
                      <span className="text-[11px] font-bold text-[var(--wd-muted)]">
                        {quest.completedSteps + 1}번째 문장
                      </span>
                    </div>

                    <h1 className="mt-5 text-[24px] font-black leading-snug tracking-tight">{card.ko}</h1>

                    {card.state === "prompt" ? (
                      <p className="mt-4 rounded-2xl border border-[var(--wd-line)] bg-[var(--wd-bg)]/40 px-4 py-3 text-[14px] font-semibold leading-relaxed text-[var(--wd-muted)]">
                        네 영어로 먼저 말해봐. 막히면 정답을 살짝 열어도 돼.
                      </p>
                    ) : null}

                    {(card.state === "reveal" || card.state === "drill") && card.en ? (
                      <div className="mt-5">
                        <p className="text-[10px] font-black tracking-[.16em] text-[var(--wd-apricot)]">NATURAL ENGLISH</p>
                        <p className="mt-2 text-[25px] font-black leading-snug tracking-tight">{card.en}</p>
                        {card.pron ? <p className="mt-2 text-[13px] font-semibold text-[var(--wd-muted)]">{card.pron}</p> : null}
                      </div>
                    ) : null}

                    <AnimatePresence>
                      {verdictStyle && answerVerdict ? (
                        <m.div
                          key={`${answerVerdict.tier}-${quest.completedSteps}`}
                          initial={reduceMotion ? false : { opacity: 0, scale: 0.88, y: 8 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          className="mt-5 flex items-center gap-3 rounded-2xl px-4 py-3"
                          style={{ color: verdictStyle.color, background: verdictStyle.bg }}
                        >
                          <span className="text-2xl" aria-hidden>{verdictStyle.emoji}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-black">{verdictStyle.label}</p>
                            <p className="mt-0.5 line-clamp-2 text-[12px] font-semibold opacity-80">{answerVerdict.detail}</p>
                          </div>
                          {answerVerdict.tier !== "garbage" && quest.lastReward ? (
                            <span className="shrink-0 rounded-full bg-white/55 px-2.5 py-1 text-[11px] font-black">
                              +{quest.lastReward}
                            </span>
                          ) : null}
                        </m.div>
                      ) : null}
                    </AnimatePresence>

                    {live && onRevealAnswer && onNext ? (
                      <div className="mt-5 grid grid-cols-[.8fr_1.2fr] gap-3">
                        <button
                          type="button"
                          onClick={onRevealAnswer}
                          className="min-h-12 rounded-2xl border border-[var(--wd-line)] bg-[var(--wd-card-solid)] px-3 text-[13px] font-black text-[var(--wd-ink)] transition active:scale-[.98]"
                        >
                          {answerVisible ? "정답 다시" : "정답 보기"}
                        </button>
                        <button
                          type="button"
                          onClick={onNext}
                          className="min-h-12 rounded-2xl bg-[var(--wd-accent)] px-3 text-[14px] font-black text-[#171021] transition active:scale-[.98]"
                        >
                          다음 문장
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="py-2 text-center">
                    <p className="text-[11px] font-black tracking-[.16em] text-[var(--wd-accent)]">5 MINUTE QUEST</p>
                    <h1 className="mt-3 text-[26px] font-black tracking-tight">하루 다섯 문장이면 충분해.</h1>
                    <p className="mx-auto mt-3 max-w-[330px] text-[14px] font-semibold leading-relaxed text-[var(--wd-muted)]">
                      부담 없이 말하고, 바로 고치고, 작은 보상까지 받고 끝내자.
                    </p>
                  </div>
                )}
              </m.section>
            )}
          </AnimatePresence>
        </main>

        {!quest.isComplete ? (
          <footer className="relative z-[2] px-5 pb-[max(env(safe-area-inset-bottom),18px)] pt-2">
            {live ? (
              <button
                type="button"
                onClick={onStop}
                className="mx-auto flex min-h-12 w-full max-w-[460px] items-center justify-center gap-3 rounded-2xl border border-[var(--wd-line)] bg-[var(--wd-card)] px-4 text-[13px] font-black text-[var(--wd-muted)] backdrop-blur-xl transition active:scale-[.98]"
              >
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--wd-apricot)] opacity-50 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--wd-apricot)]" />
                </span>
                마이크 켜짐 · 오늘 그만하기
              </button>
            ) : (
              <button
                type="button"
                onClick={beginSession}
                disabled={busy || phase === "blocked"}
                className="mx-auto flex min-h-16 w-full max-w-[460px] items-center justify-center gap-3 rounded-[22px] bg-gradient-to-r from-[var(--wd-accent)] to-[var(--wd-accent-2)] px-5 text-[15px] font-black text-[#171021] shadow-[0_16px_36px_-18px_rgba(163,126,255,.9)] transition active:scale-[.98] disabled:opacity-50"
              >
                {busy ? (
                  <span className="wd-spin h-5 w-5 rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                )}
                {primaryLabel}
              </button>
            )}
          </footer>
        ) : null}

        {sheetOpen ? (
          <div className="absolute inset-0 z-20 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="학습 설정">
            <button
              type="button"
              aria-label="설정 닫기"
              onClick={() => setSheetOpen(false)}
              className="absolute inset-0 bg-black/45 backdrop-blur-[3px]"
            />
            <m.div
              initial={reduceMotion ? false : { y: 50, opacity: 0.7 }}
              animate={{ y: 0, opacity: 1 }}
              className="relative rounded-t-[30px] border-t border-[var(--wd-line)] bg-[var(--wd-card-solid)] px-6 pb-[max(env(safe-area-inset-bottom),22px)] pt-3"
              style={{ boxShadow: "0 -20px 54px -22px rgba(0,0,0,.7)" }}
            >
              <button
              type="button"
              onClick={() => setSheetOpen(false)}
              aria-label="설정 적용하고 닫기"
              className="mx-auto flex min-h-[44px] w-20 items-center justify-center rounded-full"
              >
                <span aria-hidden className="h-1 w-10 rounded-full bg-[var(--wd-line)]" />
              </button>

              <div className="mt-3 flex items-center justify-between">
                <h2 className="text-[20px] font-black">내 밤에 맞추기</h2>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="min-h-[44px] rounded-full border border-[var(--wd-line)] px-4 text-[13px] font-black"
                >
                  {theme === "dark" ? "☀ 밝게" : "☾ 어둡게"}
                </button>
              </div>

              <p className="mt-6 text-[11px] font-black tracking-[.14em] text-[var(--wd-muted)]">코치 목소리</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {VOICE_CHOICES.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => pickVoice(choice.id)}
                    className={`min-h-14 rounded-2xl border px-2 transition active:scale-[.97] ${
                      voiceName === choice.id
                        ? "border-[var(--wd-accent)] bg-[var(--wd-accent-soft)] text-[var(--wd-accent)]"
                        : "border-[var(--wd-line)] text-[var(--wd-muted)]"
                    }`}
                  >
                    <span className="block text-[13px] font-black">{choice.label}</span>
                    <span className="mt-0.5 block text-[10px] font-semibold">{choice.hint}</span>
                  </button>
                ))}
              </div>

              <p className="mt-5 text-[11px] font-black tracking-[.14em] text-[var(--wd-muted)]">내 말 기다리기</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {WAIT_CHOICES.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => pickWait(choice.id)}
                    className={`min-h-14 rounded-2xl border transition active:scale-[.97] ${
                      vadPreset === choice.id
                        ? "border-[var(--wd-accent)] bg-[var(--wd-accent-soft)] text-[var(--wd-accent)]"
                        : "border-[var(--wd-line)] text-[var(--wd-muted)]"
                    }`}
                  >
                    <span className="block text-[13px] font-black">{choice.label}</span>
                    <span className="mt-0.5 block text-[10px] font-semibold">{choice.hint}</span>
                  </button>
                ))}
              </div>

              {settingsSlot ? <div className="mt-5">{settingsSlot}</div> : null}

              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="mt-6 min-h-13 w-full rounded-2xl bg-[var(--wd-accent)] px-4 text-[14px] font-black text-[#171021] transition active:scale-[.98]"
              >
                이대로 할게
              </button>
            </m.div>
          </div>
        ) : null}

        <style>{`
          .wd-stars {
            background-image:
              radial-gradient(circle at 14% 18%, currentColor 0 1px, transparent 1.5px),
              radial-gradient(circle at 82% 22%, currentColor 0 1px, transparent 1.5px),
              radial-gradient(circle at 68% 72%, currentColor 0 1px, transparent 1.5px),
              radial-gradient(circle at 22% 78%, currentColor 0 1px, transparent 1.5px);
            background-size: 120px 120px, 170px 170px, 150px 150px, 190px 190px;
          }
          @keyframes wd-listen {
            0%, 100% { opacity: .35; transform: scale(.8); }
            50% { opacity: 1; transform: scale(1.2); }
          }
          .wd-listen-dot { animation: wd-listen 1.35s ease-in-out infinite; }
          @keyframes wd-spin { to { transform: rotate(360deg); } }
          .wd-spin { animation: wd-spin .8s linear infinite; }
          @media (prefers-reduced-motion: reduce) {
            .wd-listen-dot, .wd-spin { animation-duration: .01ms; animation-iteration-count: 1; }
          }
        `}</style>
      </div>
    </LazyMotion>
  );
}
