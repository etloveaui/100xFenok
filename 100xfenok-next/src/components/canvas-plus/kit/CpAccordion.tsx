import type { DetailsHTMLAttributes, ReactNode } from "react";

import { cpClassNames } from "./internal";

export type CpAccordionProps = DetailsHTMLAttributes<HTMLDetailsElement> & {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
};

export default function CpAccordion({ title, meta, children, className, ...props }: CpAccordionProps) {
  return (
    <details className={cpClassNames("cpw5-accordion", className)} data-cp-accordion {...props}>
      <summary className="cpw5-accordion__summary">
        <span className="cpw5-accordion__summary-text">
          {title}
          {meta ? <span className="cpw5-accordion__meta">{meta}</span> : null}
        </span>
        <span className="cpw5-accordion__chev" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="cpw5-accordion__body">{children}</div>
    </details>
  );
}
