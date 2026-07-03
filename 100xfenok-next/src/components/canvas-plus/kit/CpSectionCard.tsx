import type { HTMLAttributes, ReactNode } from "react";

import { cpClassNames } from "./internal";

export type CpSectionCardVariant = "default" | "edge";

export type CpSectionCardProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode;
  meta?: ReactNode;
  eyebrow?: ReactNode;
  footnote?: ReactNode;
  variant?: CpSectionCardVariant;
  children: ReactNode;
};

export default function CpSectionCard({
  title,
  meta,
  eyebrow,
  footnote,
  variant = "default",
  className,
  children,
  ...props
}: CpSectionCardProps) {
  return (
    <section
      className={cpClassNames("cpw5-section", className)}
      data-variant={variant}
      data-cp-section-card
      {...props}
    >
      {eyebrow ? <p className="cpw5-section__eyebrow">{eyebrow}</p> : null}
      <div className="cpw5-section__head">
        <h3>{title}</h3>
        {meta ? <span>{meta}</span> : null}
      </div>
      <div className="cpw5-section__body">{children}</div>
      {footnote ? <p className="cpw5-section__footnote">{footnote}</p> : null}
    </section>
  );
}
