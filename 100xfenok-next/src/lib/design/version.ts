/**
 * Design version detection helpers.
 *
 * - Server: read from URL `?v2=1` / `?v3=1` / `?v5=1` / `?v6=1` (via `searchParams` prop)
 * - Client: read from `useSearchParams()` or env override
 *
 * Default = 'v5' (promoted 2026-06-26, owner mandate). '?v1=1' or a persisted
 * 'v1' cookie is the V1 backdoor — always reachable and byte-intact.
 * 'v2' = Claude Design V2 handoff (P0+P1+P2 audit fixes, gated rollout).
 * 'v3' = Claude Design V3-C Watch & Alert (pins + alerts + localStorage, gated rollout).
 * 'v5' = Pro finance home command center (isolated rollout).
 * 'v6' = CANVAS+ home production candidate (non-default until final cutover).
 */

export type DesignVersion = "v1" | "v2" | "v3" | "v4" | "v5" | "v6";

const ENV_OVERRIDE: DesignVersion | null =
  process.env.NEXT_PUBLIC_DESIGN_V6 === "1"
    ? "v6"
    : process.env.NEXT_PUBLIC_DESIGN_V5 === "1"
    ? "v5"
    : process.env.NEXT_PUBLIC_DESIGN_V4 === "1"
    ? "v4"
    : process.env.NEXT_PUBLIC_DESIGN_V3 === "1"
      ? "v3"
      : process.env.NEXT_PUBLIC_DESIGN_V2 === "1"
        ? "v2"
        : null;

function readFlag(
  raw: string | string[] | undefined,
): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "1";
}

/**
 * Server-side helper. Pass the awaited searchParams from a server component.
 */
export function getDesignVersionFromSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
  persistedVersion?: string | null,
): DesignVersion {
  // V1 backdoor: explicit ?v1=1 or a persisted v1 cookie always wins, so V1
  // stays reachable + byte-intact after the v5 default promotion (HARD constraint).
  if (readFlag(searchParams?.v1)) return "v1";
  if (persistedVersion === "v1") return "v1";
  if (ENV_OVERRIDE) return ENV_OVERRIDE;
  if (readFlag(searchParams?.v6)) return "v6";
  if (readFlag(searchParams?.v5)) return "v5";
  if (readFlag(searchParams?.v4)) return "v4";
  if (readFlag(searchParams?.v3)) return "v3";
  if (readFlag(searchParams?.v2)) return "v2";
  if (persistedVersion === "v6") return "v6";
  if (persistedVersion === "v5") return "v5";
  return "v6"; // default promoted v5 -> v6 (2026-07-03 owner P4 flip)
}

/**
 * Client-side helper. Pass `useSearchParams()` result.
 */
export function getDesignVersionFromQuery(
  query: URLSearchParams | null | undefined,
): DesignVersion {
  if (query?.get("v1") === "1") return "v1";
  if (ENV_OVERRIDE) return ENV_OVERRIDE;
  if (query?.get("v6") === "1") return "v6";
  if (query?.get("v5") === "1") return "v5";
  if (query?.get("v4") === "1") return "v4";
  if (query?.get("v3") === "1") return "v3";
  if (query?.get("v2") === "1") return "v2";
  return "v6"; // default promoted v5 -> v6 (2026-07-03 owner P4 flip)
}
