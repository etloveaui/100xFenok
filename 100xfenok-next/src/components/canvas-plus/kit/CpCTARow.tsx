import type { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

import { cpClassNames } from "./internal";

type CpCTAButtonBase = {
  label: ReactNode;
  href?: string;
  disabled?: boolean;
};

export type CpCTAButtonProps = CpCTAButtonBase &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement> & ButtonHTMLAttributes<HTMLButtonElement>, "href" | "disabled">;

export type CpCTARowProps = HTMLAttributes<HTMLDivElement> & {
  primary?: CpCTAButtonProps;
  secondary?: CpCTAButtonProps;
  note?: ReactNode;
};

function CpCTAButton({ variant, ...button }: CpCTAButtonProps & { variant: "primary" | "secondary" }) {
  const { label, href, disabled, ...rest } = button;
  const sharedClassName = cpClassNames("cpw5-cta-btn", `cpw5-cta-btn--${variant}`);

  if (href && !disabled) {
    return (
      <a className={sharedClassName} href={href} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {label}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={sharedClassName}
      disabled={disabled}
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {label}
    </button>
  );
}

export default function CpCTARow({ primary, secondary, note, className, ...props }: CpCTARowProps) {
  return (
    <div className={cpClassNames("cpw5-cta-row", className)} data-cp-cta-row {...props}>
      {primary ? <CpCTAButton {...primary} variant="primary" /> : null}
      {secondary ? <CpCTAButton {...secondary} variant="secondary" /> : null}
      {note ? <p className="cpw5-cta-row__note">{note}</p> : null}
    </div>
  );
}
