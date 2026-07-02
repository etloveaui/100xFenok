import type { HTMLAttributes } from "react";

type CpBadgeTone = "positive" | "negative" | "warning" | "neutral";

function cpClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type CpBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: CpBadgeTone;
};

export default function CpBadge({ tone = "neutral", className, ...props }: CpBadgeProps) {
  return <span className={cpClassNames("cp-badge", className)} data-tone={tone} {...props} />;
}
