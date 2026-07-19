import { dataStateTone, type DataState } from "@/lib/data-state";

export default function AppShellFreshnessPill({ state }: { state?: DataState | null }) {
  if (!state) return null;

  return (
    <span className={`data-shell-pill ${dataStateTone(state.status)}`} data-app-shell-freshness="true">
      <span />
      {state.label}
    </span>
  );
}
