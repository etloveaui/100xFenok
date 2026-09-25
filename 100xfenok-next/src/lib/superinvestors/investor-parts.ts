/**
 * SEC 13F investor parts resolver (fh-654).
 *
 * The public mirror compact-serializes investor files and, when a compact file
 * would still exceed the split cap, publishes a small parts manifest plus
 * quarter-range part files. Consumers resolve the manifest here so the page
 * keeps the complete history without knowing which representation shipped.
 */

export const SEC13F_INVESTOR_PARTS_SCHEMA = "sec13f-investor-parts/v1";

export interface Sec13fInvestorPartsManifest {
  schema: typeof SEC13F_INVESTOR_PARTS_SCHEMA;
  investor: Record<string, unknown>;
  filings_total?: number;
  parts: Array<{
    path: string;
    count?: number;
    quarters?: [string | null, string | null];
  }>;
}

export function isSec13fInvestorPartsManifest(
  value: unknown,
): value is Sec13fInvestorPartsManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { schema?: unknown; parts?: unknown };
  return candidate.schema === SEC13F_INVESTOR_PARTS_SCHEMA && Array.isArray(candidate.parts);
}

export async function resolveSec13fInvestorPayload<T>(payload: T): Promise<T> {
  if (!isSec13fInvestorPartsManifest(payload)) return payload;
  const responses = await Promise.all(
    payload.parts.map((part) => fetch(part.path, { cache: "force-cache" })),
  );
  const filings: unknown[] = [];
  for (let index = 0; index < responses.length; index += 1) {
    const part = payload.parts[index];
    const response = responses[index];
    if (!response.ok) {
      throw new Error(`sec13f investor part fetch failed: ${response.status} (${part.path})`);
    }
    const body = (await response.json()) as { filings?: unknown };
    if (!Array.isArray(body.filings)) {
      throw new Error(`sec13f investor part is malformed: ${part.path}`);
    }
    if (typeof part.count === "number" && body.filings.length !== part.count) {
      throw new Error(
        `sec13f investor part count mismatch: ${part.path} carries ${body.filings.length} filings, expected ${part.count}`,
      );
    }
    filings.push(...body.filings);
  }
  if (typeof payload.filings_total === "number" && filings.length !== payload.filings_total) {
    throw new Error(
      `sec13f investor assembly mismatch: ${filings.length} of ${payload.filings_total} filings loaded`,
    );
  }
  return {
    ...payload,
    investor: { ...payload.investor, filings },
  } as T;
}
