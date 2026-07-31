export type WindDownLumiState =
  | "idle"
  | "prompt"
  | "listening"
  | "thinking"
  | "correct"
  | "retry"
  | "rescue"
  | "celebrate";

const LUMI_STATES: Record<
  WindDownLumiState,
  {
    label: string;
    glyph: string;
    accent: string;
    motion: string;
  }
> = {
  idle: {
    label: "곁에서 기다리는 중",
    glyph: "·",
    accent: "bg-[var(--wd-text-muted)] shadow-[0_0_28px_var(--wd-text-muted)]",
    motion: "motion-safe:animate-[pulse_4s_ease-in-out_infinite]",
  },
  prompt: {
    label: "네 차례",
    glyph: "?",
    accent: "bg-[var(--wd-accent)] shadow-[0_0_32px_var(--wd-accent)]",
    motion: "motion-safe:animate-[bounce_1.8s_ease-in-out_infinite]",
  },
  listening: {
    label: "듣고 있어",
    glyph: "⌁",
    accent: "bg-[var(--wd-listening)] shadow-[0_0_34px_var(--wd-listening)]",
    motion: "motion-safe:animate-[pulse_1.15s_ease-in-out_infinite]",
  },
  thinking: {
    label: "차분히 확인하는 중",
    glyph: "…",
    accent: "bg-[var(--wd-thinking)] shadow-[0_0_34px_var(--wd-thinking)]",
    motion: "motion-safe:animate-[spin_2.4s_linear_infinite]",
  },
  correct: {
    label: "정확히 해냈어",
    glyph: "✓",
    accent: "bg-[var(--wd-success)] shadow-[0_0_36px_var(--wd-success)]",
    motion: "motion-safe:animate-[bounce_.7s_ease-out_1]",
  },
  retry: {
    label: "한 번 더 이어가자",
    glyph: "↻",
    accent: "bg-[var(--wd-warning)] shadow-[0_0_32px_var(--wd-warning)]",
    motion: "motion-safe:animate-[pulse_1.6s_ease-in-out_2]",
  },
  rescue: {
    label: "기록을 지키고 있어",
    glyph: "!",
    accent: "bg-[var(--wd-danger)] shadow-[0_0_32px_var(--wd-danger)]",
    motion: "motion-safe:animate-[pulse_2.2s_ease-in-out_infinite]",
  },
  celebrate: {
    label: "오늘의 별이 켜졌어",
    glyph: "✦",
    accent: "bg-[var(--wd-accent)] shadow-[0_0_42px_var(--wd-accent)]",
    motion: "motion-safe:animate-[bounce_.85s_ease-out_2]",
  },
};

type Props = {
  state: WindDownLumiState;
  message?: string;
  compact?: boolean;
  className?: string;
};

export function WindDownLumi({
  state,
  message,
  compact = false,
  className = "",
}: Props) {
  const presentation = LUMI_STATES[state];
  const size = compact ? "size-12" : "size-20";
  const coreSize = compact ? "size-7 text-base" : "size-12 text-2xl";

  return (
    <figure
      aria-label={`루미: ${presentation.label}${message ? `. ${message}` : ""}`}
      className={`flex items-center gap-3 ${compact ? "" : "flex-col text-center"} ${className}`}
    >
      <div
        aria-hidden
        className={`${size} relative grid shrink-0 place-items-center rounded-full border border-[var(--wd-border)] bg-[var(--wd-bg)]`}
      >
        <span className="absolute inset-1 rounded-full border border-white/10" />
        <span
          className={`${coreSize} ${presentation.accent} ${presentation.motion} grid place-items-center rounded-full font-black text-[var(--wd-bg)] motion-reduce:animate-none`}
        >
          {presentation.glyph}
        </span>
        {state === "listening" || state === "celebrate" ? (
          <span className="absolute inset-0 rounded-full border border-[var(--wd-accent)] opacity-40 motion-safe:animate-ping motion-reduce:animate-none" />
        ) : null}
      </div>
      <figcaption className={compact ? "min-w-0" : ""}>
        <span className="block text-[10px] font-black tracking-[0.16em] text-[var(--wd-accent)]">
          LUMI
        </span>
        <span className="mt-1 block text-sm font-black text-[var(--wd-text)]">
          {message ?? presentation.label}
        </span>
      </figcaption>
    </figure>
  );
}
