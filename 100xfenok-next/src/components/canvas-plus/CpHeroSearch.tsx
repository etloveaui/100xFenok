import type { FormHTMLAttributes, ReactNode } from "react";

import CpButton from "./CpButton";

function cpClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type CpHeroMetric = {
  label: string;
  value: ReactNode;
};

type CpHeroSearchProps = FormHTMLAttributes<HTMLFormElement> & {
  eyebrow: ReactNode;
  title: ReactNode;
  summary: ReactNode;
  placeholder: string;
  defaultValue?: string;
  metrics?: CpHeroMetric[];
};

export default function CpHeroSearch({
  eyebrow,
  title,
  summary,
  placeholder,
  defaultValue,
  metrics = [],
  className,
  ...props
}: CpHeroSearchProps) {
  return (
    <section className="cp-hero-search" data-cp-hero-search>
      <div className="cp-hero-search__copy">
        <p className="cp-lab__eyebrow">{eyebrow}</p>
        <h1 className="cp-hero-search__title">{title}</h1>
        <p className="cp-hero-search__summary">{summary}</p>
      </div>
      <form className={cpClassNames("cp-hero-search__form", className)} role="search" {...props}>
        <label className="cp-hero-search__label" htmlFor="cp-hero-search-input">Ticker or theme</label>
        <div className="cp-hero-search__control">
          <input
            id="cp-hero-search-input"
            className="cp-hero-search__input"
            name="q"
            type="search"
            autoComplete="off"
            placeholder={placeholder}
            defaultValue={defaultValue}
          />
          <CpButton variant="primary" type="submit">Search</CpButton>
        </div>
      </form>
      {metrics.length > 0 ? (
        <dl className="cp-hero-search__metrics">
          {metrics.map((metric) => (
            <div key={metric.label} className="cp-hero-search__metric">
              <dt>{metric.label}</dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
