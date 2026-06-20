"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ExpressionCard } from "@/components/admin-live/AdminLiveBench";

export type WindDownPhase = "boot" | "ready" | "connecting" | "live" | "stopped" | "blocked";

type WindDownTheme = "light" | "dark";

type Props = {
  phase: WindDownPhase;
  modeLabel?: string;
  message: string;
  card: ExpressionCard | null;
  coachLine: string | null;
  errorText: string | null;
  answerVisible?: boolean;
  voiceName: string;
  vadPreset: string;
  onVoiceChange: (voice: string) => void;
  onVadChange: (preset: "relaxed" | "balanced") => void;
  settingsSlot?: ReactNode;
  onStart: () => void;
  onStop: () => void;
  onRevealAnswer?: () => void;
  onNext?: () => void;
};

const THEME_STORAGE_KEY = "winddown-theme";
const VOICE_STORAGE_KEY = "winddown-voice";
const VAD_STORAGE_KEY = "winddown-vad";

const VOICE_CHOICES = [
  { id: "Achernar", label: "포근한 목소리", hint: "기본" },
  { id: "Aoede", label: "가벼운 목소리", hint: "산뜻" },
  { id: "Kore", label: "차분한 목소리", hint: "또렷" },
];

const WAIT_CHOICES: Array<{ id: "relaxed" | "balanced"; label: string; hint: string }> = [
  { id: "relaxed", label: "여유 있게", hint: "생각할 틈을 줘" },
  { id: "balanced", label: "보통", hint: "조금 빠르게" },
];

const WEEKDAY_PLAN: Record<number, { day: string; theme: string }> = {
  0: { day: "일요일", theme: "주간 복습 테스트" },
  1: { day: "월요일", theme: "회사 · 업무" },
  2: { day: "화요일", theme: "가족 · 친구 일상" },
  3: { day: "수요일", theme: "혼잣말 · 감정" },
  4: { day: "목요일", theme: "외출 · 쇼핑 · 식당" },
  5: { day: "금요일", theme: "회사 · 업무 심화" },
  6: { day: "토요일", theme: "자유 주제" },
};

const PALETTES: Record<WindDownTheme, Record<string, string>> = {
  light: {
    "--wd-bg": "#faf6ef",
    "--wd-wash": "radial-gradient(120% 90% at 70% 0%, #f3ecff 0%, rgba(243,236,255,0) 55%), radial-gradient(100% 80% at 10% 100%, #fdeede 0%, rgba(253,238,222,0) 50%)",
    "--wd-ink": "#3a3440",
    "--wd-muted": "#9b93a4",
    "--wd-card": "#fffefa",
    "--wd-line": "#eae2d4",
    "--wd-accent": "#7c6fb0",
    "--wd-accent-soft": "#efeaf9",
    "--wd-apricot": "#c4773f",
    "--wd-apricot-soft": "#fbeede",
    "--wd-shadow": "0 24px 48px -20px rgba(124,111,176,0.25)",
  },
  dark: {
    "--wd-bg": "#1a1726",
    "--wd-wash": "radial-gradient(120% 90% at 70% 0%, #262040 0%, rgba(38,32,64,0) 55%), radial-gradient(100% 80% at 10% 100%, #2a2030 0%, rgba(42,32,48,0) 50%)",
    "--wd-ink": "#ede7f4",
    "--wd-muted": "#8d84a0",
    "--wd-card": "#241f33",
    "--wd-line": "#37304a",
    "--wd-accent": "#a99bd9",
    "--wd-accent-soft": "#2e2745",
    "--wd-apricot": "#d9a176",
    "--wd-apricot-soft": "#3a2d28",
    "--wd-shadow": "0 24px 48px -20px rgba(0,0,0,0.55)",
  },
};

const CARD_STATE_LABEL: Record<ExpressionCard["state"], string> = {
  prompt: "먼저 말해보기",
  reveal: "자연스러운 영어",
  drill: "다시 잡기",
};

const FLOW_STEPS = ["말하기", "영어 공개", "따라하기"];

function cardFlowStep(card: ExpressionCard | null) {
  if (!card) return -1;
  if (card.state === "prompt") return 0;
  if (card.state === "reveal") return 1;
  return 2;
}

function studyPlanLine(): string {
  const shifted = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const plan = WEEKDAY_PLAN[shifted.getDay()];
  return `${plan.day} · ${plan.theme}`;
}

export default function MonaWindDown({
  phase, modeLabel = "vNext", message, card, coachLine, errorText, answerVisible = false,
  voiceName, vadPreset, onVoiceChange, onVadChange,
  settingsSlot,
  onStart, onStop, onRevealAnswer, onNext,
}: Props) {
  const [theme, setTheme] = useState<WindDownTheme>(() => {
    if (typeof window === "undefined") return "light";
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      return saved === "dark" || saved === "light" ? saved : "light";
    } catch {
      return "light";
    }
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const prefsAppliedRef = useRef(false);

  useEffect(() => {
    if (prefsAppliedRef.current || phase === "boot") return;
    prefsAppliedRef.current = true;
    try {
      const savedVoice = window.localStorage.getItem(VOICE_STORAGE_KEY);
      if (savedVoice && VOICE_CHOICES.some((choice) => choice.id === savedVoice)) onVoiceChange(savedVoice);
      const savedVad = window.localStorage.getItem(VAD_STORAGE_KEY);
      if (savedVad === "relaxed" || savedVad === "balanced") onVadChange(savedVad);
    } catch {
      // storage unavailable — keep presets
    }
  }, [phase, onVoiceChange, onVadChange]);

  const pickVoice = (id: string) => {
    onVoiceChange(id);
    try {
      window.localStorage.setItem(VOICE_STORAGE_KEY, id);
    } catch {
      // ignore
    }
  };

  const pickWait = (id: "relaxed" | "balanced") => {
    onVadChange(id);
    try {
      window.localStorage.setItem(VAD_STORAGE_KEY, id);
    } catch {
      // ignore
    }
  };

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  };

  const applySettings = () => {
    setSheetOpen(false);
  };

  const planLine = useMemo(() => studyPlanLine(), []);
  const live = phase === "live";
  const busy = phase === "connecting" || phase === "boot";
  const activeFlowStep = cardFlowStep(card);
  const controlDisabled = !card || !live || busy || !onRevealAnswer || !onNext;

  const buttonLabel = phase === "live"
    ? "듣고 있어 · 누르면 마침"
    : phase === "connecting"
      ? "연결하는 중"
      : phase === "boot"
        ? "준비 확인 중"
        : phase === "blocked"
          ? "지금은 시작할 수 없어"
          : phase === "stopped"
            ? "다시 시작"
            : "마이크 켜기";

  return (
    <div
      data-wd-theme={theme}
      style={PALETTES[theme] as React.CSSProperties}
      className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[var(--wd-bg)] text-[var(--wd-ink)] transition-colors duration-500"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "var(--wd-wash)" }} />

      <header className="relative flex items-start justify-between px-6 pt-[max(env(safe-area-inset-top),20px)]">
        <div className="wd-enter" style={{ animationDelay: "60ms" }}>
          <p className="font-[family-name:var(--font-wd-serif)] text-[26px] font-medium tracking-tight">
            Wind-Down
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-medium tracking-[0.08em] text-[var(--wd-muted)]">{planLine}</p>
            <span className="rounded-full border border-[var(--wd-line)] bg-[var(--wd-card)] px-2 py-0.5 text-[11px] font-semibold text-[var(--wd-accent)]">
              {modeLabel}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label="설정 열기"
            className="wd-enter flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--wd-line)] bg-[var(--wd-card)] shadow-sm transition-transform active:scale-95"
            style={{ animationDelay: "100ms" }}
          >
            <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="4" y1="8" x2="20" y2="8" />
              <circle cx="9" cy="8" r="2.4" fill="var(--wd-card)" />
              <line x1="4" y1="16" x2="20" y2="16" />
              <circle cx="15" cy="16" r="2.4" fill="var(--wd-card)" />
            </svg>
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "어둡게 보기" : "밝게 보기"}
            className="wd-enter flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--wd-line)] bg-[var(--wd-card)] text-[18px] shadow-sm transition-transform active:scale-95"
            style={{ animationDelay: "140ms" }}
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <section
          key={card ? card.updatedAt : "idle"}
          aria-live="polite"
          className="wd-card-in w-full max-w-[420px] rounded-[28px] border border-[var(--wd-line)] bg-[var(--wd-card)] px-7 py-8"
          style={{ boxShadow: "var(--wd-shadow)" }}
        >
          {card ? (
            <>
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-[var(--wd-accent-soft)] px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-[var(--wd-accent)]">
                  {CARD_STATE_LABEL[card.state]}
                </span>
                {card.state === "prompt" && (
                  <span className="text-[12px] font-semibold text-[var(--wd-muted)]">영어 숨김</span>
                )}
                {card.state === "reveal" && (
                  <span className="text-[12px] font-semibold text-[var(--wd-muted)]">한 번 따라 말하기</span>
                )}
                {card.state === "drill" && (
                  <span className="text-[12px] font-semibold text-[var(--wd-muted)]">천천히</span>
                )}
              </div>

              <p className="mt-5 text-[25px] font-semibold leading-snug">{card.ko}</p>

              <div className="mt-5 grid grid-cols-3 gap-2" aria-hidden>
                {FLOW_STEPS.map((step, index) => (
                  <span
                    key={step}
                    className={`h-8 rounded-full border px-2 text-[11px] font-semibold leading-8 ${
                      activeFlowStep === index
                        ? "border-[var(--wd-accent)] bg-[var(--wd-accent-soft)] text-[var(--wd-accent)]"
                        : "border-[var(--wd-line)] text-[var(--wd-muted)]"
                    }`}
                  >
                    {step}
                  </span>
                ))}
              </div>

              {card.state === "prompt" && (
                <p className="mt-5 rounded-2xl border border-[var(--wd-line)] bg-[var(--wd-bg)]/65 px-4 py-3 text-[15px] font-medium leading-relaxed text-[var(--wd-muted)]">
                  영어는 네가 먼저 말한 뒤 보여줄게.
                </p>
              )}

              {card.state === "reveal" && card.en && (
                <>
                  <p className="mt-5 text-[12px] font-semibold tracking-[0.14em] text-[var(--wd-muted)]">TARGET</p>
                  <p className="mt-2 font-[family-name:var(--font-wd-serif)] text-[28px] font-medium leading-snug">
                    {card.en}
                  </p>
                  <p className="mt-4 text-[15px] font-medium leading-relaxed text-[var(--wd-muted)]">
                    낮은 목소리로 한 번만 따라 말해봐.
                  </p>
                </>
              )}
              {card.state === "reveal" && card.pron && (
                <p className="mt-3 text-[15px] font-medium text-[var(--wd-muted)]">{card.pron}</p>
              )}

              {card.state === "drill" && (
                <>
                  {card.en ? (
                    <p className="mt-5 font-[family-name:var(--font-wd-serif)] text-[25px] font-medium leading-snug">
                      {card.en}
                    </p>
                  ) : null}
                  <p className="mt-5 inline-block rounded-2xl bg-[var(--wd-apricot-soft)] px-4 py-2 text-[15px] font-semibold text-[var(--wd-apricot)]">
                    {card.drillHint ?? "같은 문장을 천천히 다시 잡아보자"}
                  </p>
                </>
              )}
            </>
          ) : (
            <>
              <p className="font-[family-name:var(--font-wd-serif)] text-[22px] font-medium leading-relaxed">
                Tonight&rsquo;s sentences are waiting.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-[var(--wd-muted)]">
                마이크를 켜고 낮은 목소리로 &ldquo;시작&rdquo;이라고 말하면
                오늘의 문장을 가져올게.
              </p>
            </>
          )}
        </section>

        <p className="min-h-[44px] max-w-[400px] px-2 text-center text-[14px] leading-relaxed text-[var(--wd-muted)]">
          {errorText ?? coachLine ?? message}
        </p>

        {card ? (
          <div className="wd-enter grid w-full max-w-[420px] grid-cols-2 gap-3" style={{ animationDelay: "180ms" }}>
            <button
              type="button"
              onClick={onRevealAnswer}
              disabled={controlDisabled}
              className="min-h-12 rounded-2xl border border-[var(--wd-line)] bg-[var(--wd-card)] px-3 text-[14px] font-semibold text-[var(--wd-ink)] shadow-sm transition active:scale-[0.98] disabled:opacity-45"
            >
              {answerVisible ? "정답 다시 보기" : "정답 보기"}
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={controlDisabled}
              className="min-h-12 rounded-2xl bg-[var(--wd-accent)] px-3 text-[14px] font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-45"
            >
              다음
            </button>
          </div>
        ) : null}
      </main>

      <footer className="relative flex flex-col items-center gap-3 px-6 pb-[max(env(safe-area-inset-bottom),24px)]">
        <button
          type="button"
          onClick={live ? onStop : onStart}
          disabled={busy || phase === "blocked"}
          aria-label={buttonLabel}
          className={`flex h-[84px] w-[84px] items-center justify-center rounded-full transition-all duration-300 active:scale-95 disabled:opacity-50 ${
            live
              ? "wd-breathe bg-[var(--wd-accent)] text-white"
              : "border-2 border-[var(--wd-accent)] bg-[var(--wd-card)] text-[var(--wd-accent)]"
          }`}
          style={live ? { boxShadow: "0 0 0 10px var(--wd-accent-soft), var(--wd-shadow)" } : { boxShadow: "var(--wd-shadow)" }}
        >
          {busy ? (
            <span className="wd-spin inline-block h-7 w-7 rounded-full border-2 border-current border-t-transparent" />
          ) : live ? (
            <span aria-hidden className="inline-block h-7 w-7 rounded-[8px] bg-white" />
          ) : (
            <svg aria-hidden width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <path d="M12 18v3" />
            </svg>
          )}
        </button>
        <p className="text-[13px] font-medium tracking-[0.04em] text-[var(--wd-muted)]">{buttonLabel}</p>
      </footer>

      {sheetOpen && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end" role="dialog" aria-label="설정">
          <button
            type="button"
            aria-label="설정 닫기"
            onClick={() => setSheetOpen(false)}
            className="wd-fade absolute inset-0 bg-black/25 backdrop-blur-[2px]"
          />
          <div
            className="wd-sheet-in relative rounded-t-[28px] border-t border-[var(--wd-line)] bg-[var(--wd-card)] px-7 pb-[max(env(safe-area-inset-bottom),24px)] pt-3"
            style={{ boxShadow: "0 -18px 48px -18px rgba(0,0,0,0.35)" }}
          >
            <button
              type="button"
              onClick={applySettings}
              aria-label="설정 적용하고 닫기"
              className="mx-auto flex min-h-8 w-20 items-center justify-center rounded-full transition active:scale-95"
            >
              <span aria-hidden className="h-1 w-10 rounded-full bg-[var(--wd-line)]" />
            </button>

            <p className="mt-5 text-[12px] font-semibold tracking-[0.14em] text-[var(--wd-muted)]">목소리</p>
            <div className="mt-3 flex gap-2">
              {VOICE_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => pickVoice(choice.id)}
                  className={`flex min-h-14 flex-1 flex-col items-center justify-center rounded-2xl border transition-all active:scale-[0.97] ${
                    voiceName === choice.id
                      ? "border-[var(--wd-accent)] bg-[var(--wd-accent-soft)] text-[var(--wd-accent)]"
                      : "border-[var(--wd-line)] text-[var(--wd-muted)]"
                  }`}
                >
                  <span className="text-[14px] font-semibold">{choice.label}</span>
                  <span className="mt-0.5 text-[11px]">{choice.hint}</span>
                </button>
              ))}
            </div>

            <p className="mt-6 text-[12px] font-semibold tracking-[0.14em] text-[var(--wd-muted)]">내 말 기다리기</p>
            <div className="mt-3 flex gap-2">
              {WAIT_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => pickWait(choice.id)}
                  className={`flex min-h-14 flex-1 flex-col items-center justify-center rounded-2xl border transition-all active:scale-[0.97] ${
                    vadPreset === choice.id
                      ? "border-[var(--wd-accent)] bg-[var(--wd-accent-soft)] text-[var(--wd-accent)]"
                      : "border-[var(--wd-line)] text-[var(--wd-muted)]"
                  }`}
                >
                  <span className="text-[14px] font-semibold">{choice.label}</span>
                  <span className="mt-0.5 text-[11px]">{choice.hint}</span>
                </button>
              ))}
            </div>

            {settingsSlot ? (
              <div className="mt-6">
                {settingsSlot}
              </div>
            ) : null}

            <p className="mt-5 min-h-[18px] text-center text-[12px] text-[var(--wd-muted)]">
              {live ? "대화 중이라 다음 시작부터 적용돼" : "바로 적용돼"}
            </p>
            <button
              type="button"
              onClick={applySettings}
              className="mt-4 min-h-12 w-full rounded-2xl bg-[var(--wd-accent)] px-4 text-[14px] font-semibold text-white shadow-sm transition active:scale-[0.98]"
            >
              적용
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes wd-enter {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .wd-enter { opacity: 0; animation: wd-enter 600ms cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        @keyframes wd-card-in {
          from { opacity: 0; transform: translateY(14px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .wd-card-in { animation: wd-card-in 420ms cubic-bezier(0.22, 1, 0.36, 1); }
        @keyframes wd-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        .wd-breathe { animation: wd-breathe 3s ease-in-out infinite; }
        @keyframes wd-spin { to { transform: rotate(360deg); } }
        .wd-spin { animation: wd-spin 0.9s linear infinite; }
        @keyframes wd-fade { from { opacity: 0; } to { opacity: 1; } }
        .wd-fade { animation: wd-fade 240ms ease-out; }
        @keyframes wd-sheet-in {
          from { transform: translateY(28px); opacity: 0.6; }
          to { transform: translateY(0); opacity: 1; }
        }
        .wd-sheet-in { animation: wd-sheet-in 320ms cubic-bezier(0.22, 1, 0.36, 1); }
        @media (prefers-reduced-motion: reduce) {
          .wd-enter, .wd-card-in, .wd-breathe, .wd-spin { animation-duration: 0.01ms; animation-iteration-count: 1; }
        }
      `}</style>
    </div>
  );
}
