import * as React from "react";

type Variant = "primary" | "secondary" | "tab";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  active?: boolean;
};

const base = "inline-flex items-center justify-center h-8 px-3 rounded-[6px] text-[13px] font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1B73D3]";
const variantClass: Record<Variant, string> = {
  primary: "bg-[#1B73D3] text-white hover:bg-[#155fae] border border-[#1B73D3]",
  secondary: "bg-white text-[#334155] border border-[#e2e8f0] hover:bg-[#f8fafc]",
  tab: "bg-[#f1f5f9] text-[#475569] hover:bg-[#e2e8f0] border border-transparent data-[active=true]:bg-white data-[active=true]:border-[#e2e8f0] data-[active=true]:text-[#1B73D3]",
};

export function Button({ variant = "secondary", active, className = "", children, ...props }: ButtonProps) {
  return (
    <button className={`${base} ${variantClass[variant]} ${className}`} data-active={active} {...props}>
      {children}
    </button>
  );
}
