import type { HTMLAttributes, ReactNode } from "react";

type CpFeatureTileTone = "accent" | "positive" | "negative" | "warning" | "neutral";

function cpClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type CpFeatureTileProps = HTMLAttributes<HTMLElement> & {
  label: ReactNode;
  title: ReactNode;
  value: ReactNode;
  detail: ReactNode;
  tone?: CpFeatureTileTone;
};

export default function CpFeatureTile({
  label,
  title,
  value,
  detail,
  tone = "accent",
  className,
  ...props
}: CpFeatureTileProps) {
  return (
    <article className={cpClassNames("cp-feature-tile", className)} data-tone={tone} data-cp-feature-tile {...props}>
      <div className="cp-feature-tile__topline">
        <span>{label}</span>
        <span className="cp-feature-tile__dot" aria-hidden="true" />
      </div>
      <h2 className="cp-feature-tile__title">{title}</h2>
      <strong className="cp-feature-tile__value">{value}</strong>
      <p className="cp-feature-tile__detail">{detail}</p>
    </article>
  );
}
