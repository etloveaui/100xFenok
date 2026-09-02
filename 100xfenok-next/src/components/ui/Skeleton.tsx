import * as React from "react";

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`p-4 flex flex-col gap-3 ${className}`} aria-hidden>
      <div className="flex items-center justify-between h-11 px-4 border-b border-[#e2e8f0]">
        <div className="flex flex-col gap-1">
          <span className="block w-[60px] h-[10px] bg-[#f1f5f9] rounded" />
          <span className="block w-[120px] h-[14px] bg-[#f1f5f9] rounded" />
        </div>
        <span className="block w-14 h-5 bg-[#f1f5f9] rounded-full" />
      </div>
      {[80, 70, 90].map((w, i) => (
        <div key={i} className="grid grid-cols-[120px_1fr_90px] items-center h-9 px-4">
          <span className="block h-3 bg-[#f1f5f9] rounded" style={{ width: w }} />
          <span className="block h-3 bg-[#f1f5f9] rounded w-[60%]" />
          <span className="block h-3 bg-[#f1f5f9] rounded w-14 justify-self-end" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonInline({ width = 80, className = "" }: { width?: number; className?: string }) {
  return <span className={`inline-block h-3 bg-[#f1f5f9] rounded animate-pulse ${className}`} style={{ width }} />;
}
