import * as React from "react";

type RowProps = React.HTMLAttributes<HTMLDivElement> & {
  active?: boolean;
};

export function Row({ active, className = "", children, ...props }: RowProps) {
  return (
    <div
      className={`grid grid-cols-[120px_1fr_90px] items-center h-9 px-4 border-t border-[#f1f5f9] text-[13px] transition-colors duration-150 hover:bg-[#f8fafc] focus-visible:bg-[#f8fafc] focus-visible:outline-none data-[active=true]:bg-[#f8fafc] data-[active=true]:shadow-[inset_2px_0_0_#1B73D3] hover:shadow-[inset_2px_0_0_#1B73D3] ${className}`}
      data-active={active}
      tabIndex={0}
      {...props}
    >
      {children}
    </div>
  );
}
