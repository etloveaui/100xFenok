import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type CpValuationBandTone = "positive" | "negative" | "warning" | "neutral";

function cpClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type CpValuationBandProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode;
  value: ReactNode;
  position: number;
  lowLabel: ReactNode;
  midLabel: ReactNode;
  highLabel: ReactNode;
  tone?: CpValuationBandTone;
  summary?: ReactNode;
};

export default function CpValuationBand({
  label,
  value,
  position,
  lowLabel,
  midLabel,
  highLabel,
  tone = "neutral",
  summary,
  className,
  ...props
}: CpValuationBandProps) {
  const boundedPosition = Math.max(0, Math.min(100, position));
  const style = { "--cp-band-position": `${boundedPosition}%` } as CSSProperties;

  return (
    <div className={cpClassNames("cp-valuation-band", className)} data-tone={tone} data-cp-valuation-band style={style} {...props}>
      <div className="cp-valuation-band__header">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="cp-valuation-band__track" aria-hidden="true">
        <span className="cp-valuation-band__marker" />
      </div>
      <div className="cp-valuation-band__labels">
        <span>{lowLabel}</span>
        <span>{midLabel}</span>
        <span>{highLabel}</span>
      </div>
      {summary ? <p className="cp-valuation-band__summary">{summary}</p> : null}
    </div>
  );
}
