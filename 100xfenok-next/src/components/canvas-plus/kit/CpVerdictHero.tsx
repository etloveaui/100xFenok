import type { HTMLAttributes, ReactNode } from "react";

import { cpClassNames, type CpTone } from "./internal";

export type CpVerdictHeroTrustChip = {
  id?: string | number;
  label: ReactNode;
  value?: ReactNode;
  tone?: CpTone;
  freshness?: boolean;
};

export type CpVerdictHeroProps = HTMLAttributes<HTMLElement> & {
  eyebrow: ReactNode;
  verdict: ReactNode;
  sub?: ReactNode;
  trustChips?: readonly CpVerdictHeroTrustChip[];
};

export default function CpVerdictHero({
  eyebrow,
  verdict,
  sub,
  trustChips,
  className,
  ...props
}: CpVerdictHeroProps) {
  return (
    <section className={cpClassNames("cpw5-hero", className)} data-cp-verdict-hero {...props}>
      <div className="cpw5-hero__top">
        <p className="cpw5-hero__eyebrow">{eyebrow}</p>
        {trustChips && trustChips.length > 0 ? (
          <div className="cpw5-hero__trust-row">
            {trustChips.map((chip, index) => (
              <span
                key={chip.id ?? index}
                className="cpw5-hero__trust-chip"
                data-tone={chip.tone ?? "neutral"}
              >
                {chip.freshness ? <span className="cpw5-hero__trust-dot" aria-hidden="true" /> : null}
                <span className="cpw5-hero__trust-label">{chip.label}</span>
                {chip.value != null ? (
                  <strong className="cpw5-hero__trust-value">{chip.value}</strong>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <h2 className="cpw5-hero__verdict">{verdict}</h2>
      {sub ? <p className="cpw5-hero__sub">{sub}</p> : null}
    </section>
  );
}
