import type { HTMLAttributes, ReactNode } from "react";
import TransitionLink from "@/components/TransitionLink";

type Tone = "default" | "info" | "success" | "warn" | "danger";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const calloutToneClass: Record<Tone, string> = {
  default: "border-[var(--c-line)] bg-[var(--c-panel)] text-[var(--c-ink)]",
  info: "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--c-ink)]",
  success: "border-[var(--up-border)] bg-[var(--c-up-soft)] text-[var(--c-ink)]",
  warn: "border-[var(--warn-border)] bg-[var(--c-warn-soft)] text-[var(--c-ink)]",
  danger: "border-[var(--down-border)] bg-[var(--c-down-soft)] text-[var(--c-ink)]",
};

const badgeToneClass: Record<Tone, string> = {
  default: "border-[var(--c-line)] bg-[var(--c-surface-2)] text-[var(--c-ink-2)]",
  info: "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]",
  success: "border-[var(--up-border)] bg-[var(--c-up-soft)] text-[var(--c-up)]",
  warn: "border-[var(--warn-border)] bg-[var(--c-warn-soft)] text-[var(--c-warn-ink)]",
  danger: "border-[var(--down-border)] bg-[var(--c-down-soft)] text-[var(--c-down)]",
};

export function SurfacePanel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cx("panel", className)} {...props} />;
}

export function SurfaceHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("panel-h", className)} {...props} />;
}

export function SurfaceBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("panel-b", className)} {...props} />;
}

export function SurfaceCallout({
  tone = "default",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { tone?: Tone }) {
  return (
    <section
      className={cx(
        "rounded-[var(--r-sm)] border p-[var(--s3)] shadow-[var(--sh-sm)]",
        calloutToneClass[tone],
        className,
      )}
      {...props}
    />
  );
}

export function SurfaceBadge({
  tone = "default",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-[var(--s1)] rounded-full border px-[var(--s2)] py-[var(--s1)] text-[10px] font-black tabular-nums",
        badgeToneClass[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function SurfaceActionLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TransitionLink href={href} className={cx("data-shell-link", className)}>
      {children}
    </TransitionLink>
  );
}
