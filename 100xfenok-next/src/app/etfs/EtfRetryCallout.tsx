"use client";

interface EtfRetryCalloutProps {
  title: string;
  desc: string;
  onRetry: () => void;
  actionLabel?: string;
  compact?: boolean;
}

export default function EtfRetryCallout({
  title,
  desc,
  onRetry,
  actionLabel = "다시 시도",
  compact = false,
}: EtfRetryCalloutProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`rounded-xl border border-[var(--c-down)] bg-[var(--c-down-soft)] px-3 ${compact ? "py-2" : "py-3"}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black text-[var(--c-down)]">{title}</p>
          <p className="mt-1 text-[11px] font-semibold leading-relaxed text-[var(--c-ink)]">{desc}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-full border border-[var(--c-down)] bg-[var(--c-panel)] px-4 text-[11px] font-black text-[var(--c-down)] transition hover:bg-[var(--c-surface)] hover:text-[var(--c-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-interactive"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
