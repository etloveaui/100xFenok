import type { ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function DataProvenanceNote({
  children,
  details = [],
  title = "연결 근거",
  className,
}: {
  children: ReactNode;
  details?: Array<string | null | undefined | false>;
  title?: string;
  className?: string;
}) {
  const cleanDetails = details.filter((item): item is string => typeof item === "string" && item.length > 0);
  return (
    <div
      data-testid="data-provenance-note"
      className={cx(
        "rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold leading-4 text-slate-600",
        className,
      )}
    >
      <p>
        <span className="font-black">{title}</span>
        <span className="ml-1">{children}</span>
      </p>
      {cleanDetails.length ? <p className="mt-1 font-black tabular-nums">{cleanDetails.join(" · ")}</p> : null}
    </div>
  );
}
