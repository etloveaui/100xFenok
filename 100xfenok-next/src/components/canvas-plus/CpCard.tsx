import type { HTMLAttributes, ReactNode } from "react";

type CpDensity = "compact" | "default" | "comfy";

function cpClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type CpCardProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  density?: CpDensity;
};

export default function CpCard({
  title,
  meta,
  action,
  footer,
  density = "default",
  className,
  children,
  ...props
}: CpCardProps) {
  return (
    <article className={cpClassNames("cp-card", className)} data-density={density} {...props}>
      <header className="cp-card__header">
        <div>
          <h2 className="cp-card__title">{title}</h2>
          {meta ? <p className="cp-card__meta">{meta}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </header>
      <div className="cp-card__body">{children}</div>
      {footer ? <footer className="cp-card__footer">{footer}</footer> : null}
    </article>
  );
}
