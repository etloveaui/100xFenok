import type { DashboardFreshnessCadence } from "./types";

export type ResponsiveFreshnessLabels = {
  label: string;
  compactLabel: string;
  microLabel: string;
};

const CADENCE_LABELS: Record<
  Exclude<DashboardFreshnessCadence, "realtime">,
  { full: string; compact: string }
> = {
  daily: { full: "일간", compact: "일" },
  weekly: { full: "주간", compact: "주" },
  quarterly: { full: "분기", compact: "분" },
};

function dateParts(value: string) {
  const iso = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return {
      iso: value,
      md: value,
    };
  }
  const [, , month, day] = match;
  return {
    iso,
    md: `${month}.${day}`,
  };
}

function quarterParts(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { full: value, compact: value };
  }
  const year = parsed.getUTCFullYear();
  const quarter = Math.floor(parsed.getUTCMonth() / 3) + 1;
  return {
    full: `Q${quarter} ${year}`,
    compact: `${String(year).slice(2)}Q${quarter}`,
  };
}

export function formatFreshnessLabels(
  cadence: DashboardFreshnessCadence,
  value: string | null,
  options: { realtimeLabel?: string; realtimeCompactLabel?: string } = {},
): ResponsiveFreshnessLabels {
  if (cadence === "realtime") {
    const label = options.realtimeLabel ?? "실시간";
    return {
      label,
      compactLabel: options.realtimeCompactLabel ?? label,
      microLabel: options.realtimeCompactLabel ?? label,
    };
  }

  const cadenceLabel = CADENCE_LABELS[cadence];
  if (!value) {
    return {
      label: cadenceLabel.full,
      compactLabel: cadenceLabel.compact,
      microLabel: cadenceLabel.compact,
    };
  }

  if (cadence === "quarterly") {
    const quarter = quarterParts(value);
    return {
      label: `${cadenceLabel.full} · ${quarter.full}`,
      compactLabel: `${cadenceLabel.compact} · ${quarter.compact}`,
      microLabel: quarter.compact,
    };
  }

  const date = dateParts(value);
  return {
    label: `${cadenceLabel.full} · ${date.iso}`,
    compactLabel: `${cadenceLabel.compact} · ${date.md}`,
    microLabel: date.md,
  };
}
