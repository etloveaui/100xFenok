import { METRIC_DEFS } from "./metrics";
import type { WatchOp, WatchableMetric } from "./types";

type ParsedWatch = {
  metric: WatchableMetric;
  op: WatchOp;
  threshold: number;
};

const OP_ALIASES: Record<string, WatchOp> = {
  ">": ">",
  ">=": ">=",
  "≥": ">=",
  "<": "<",
  "<=": "<=",
  "≤": "<=",
  "=": "=",
  "==": "=",
  돌파: ">",
  이상: ">=",
  하회: "<",
  이하: "<=",
};

/**
 * Parse a free-form Cmd+K query like:
 *   "watch VIX > 25"     → { VIX, '>', 25 }
 *   "VIX 25 돌파"        → { VIX, '>', 25 }
 *   "F&G 80 이상"         → { FG, '>=', 80 }
 *   "watch SOFR > 5"     → { SOFR, '>', 5 }
 *
 * Returns null if the query doesn't resolve to a valid watch.
 */
export function parseWatchQuery(rawInput: string): ParsedWatch | null {
  if (!rawInput) return null;
  const input = rawInput.trim().replace(/^watch\s+/i, "");
  if (!input) return null;

  let metric: WatchableMetric | null = null;
  let stripped = input;
  for (const def of METRIC_DEFS) {
    const labelRegex = new RegExp(
      `\\b(${def.k}|${escapeRegExp(def.label)})\\b`,
      "i",
    );
    if (labelRegex.test(stripped)) {
      metric = def.k;
      stripped = stripped.replace(labelRegex, " ").trim();
      break;
    }
  }
  if (!metric) return null;

  let op: WatchOp | null = null;
  for (const [token, mapped] of Object.entries(OP_ALIASES)) {
    if (stripped.includes(token)) {
      op = mapped;
      stripped = stripped.replace(token, " ");
      break;
    }
  }

  const numberMatch = stripped.match(/-?\d+(?:\.\d+)?/);
  if (!numberMatch) return null;
  const threshold = Number(numberMatch[0]);
  if (Number.isNaN(threshold)) return null;

  if (!op) op = ">";

  return { metric, op, threshold };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
