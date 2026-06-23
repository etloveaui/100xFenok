import {
  dataStateTone,
  formatAsOf,
  type DataReadinessStatus,
  type DataState,
} from "@/lib/data-state";

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function noticeToneClass(status: DataReadinessStatus): string {
  const tone = dataStateTone(status);
  if (tone === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-800";
  if (tone === "error") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function badgeToneClass(status: DataReadinessStatus): string {
  const tone = dataStateTone(status);
  if (tone === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-700";
  if (tone === "error") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function DataStateBadge({
  state,
  prefix = "기준",
  className,
}: {
  state: DataState;
  prefix?: string;
  className?: string;
}) {
  const asOf = formatAsOf(state.asOf);
  const text = asOf ? `${prefix ? `${prefix} ` : ""}${asOf}${state.status === "stale" ? " · 오래됨" : ""}` : state.label;
  return (
    <span
      data-testid="data-state-badge"
      data-data-state={state.status}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black tabular-nums",
        badgeToneClass(state.status),
        className,
      )}
      title={state.reason ?? state.detail}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  );
}

export default function DataStateNotice({
  state,
  className,
  showAsOf = true,
}: {
  state: DataState;
  className?: string;
  showAsOf?: boolean;
}) {
  const asOf = showAsOf ? formatAsOf(state.asOf) : null;
  return (
    <div
      data-testid="data-state-notice"
      data-data-state={state.status}
      className={cx("rounded-[1.25rem] border px-4 py-3 text-xs font-semibold leading-5", noticeToneClass(state.status), className)}
    >
      <span className="font-black">{state.label}</span>
      <span className="ml-2">{state.detail}</span>
      {asOf ? <span className="ml-2 whitespace-nowrap font-black tabular-nums">기준 {asOf}</span> : null}
    </div>
  );
}
