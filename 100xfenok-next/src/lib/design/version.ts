/**
 * Design version detection helpers.
 *
 * - Server: read from URL `?v2=1` / `?v3=1` / `?v5=1` (via `searchParams` prop)
 * - Client: read from `useSearchParams()` or env override
 *
 * Default = 'v1' (existing dashboard, unchanged).
 * 'v2' = Claude Design V2 handoff (P0+P1+P2 audit fixes, gated rollout).
 * 'v3' = Claude Design V3-C Watch & Alert (pins + alerts + localStorage, gated rollout).
 * 'v5' = Pro finance home command center (isolated rollout).
 */

export type DesignVersion = "v1" | "v2" | "v3" | "v4" | "v5";

const ENV_OVERRIDE: DesignVersion | null =
  process.env.NEXT_PUBLIC_DESIGN_V5 === "1"
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
  if (ENV_OVERRIDE) return ENV_OVERRIDE;
  if (readFlag(searchParams?.v5)) return "v5";
  if (readFlag(searchParams?.v4)) return "v4";
  if (readFlag(searchParams?.v3)) return "v3";
  if (readFlag(searchParams?.v2)) return "v2";
  if (persistedVersion === "v5") return "v5";
  return "v1";
}

/**
 * Client-side helper. Pass `useSearchParams()` result.
 */
export function getDesignVersionFromQuery(
  query: URLSearchParams | null | undefined,
): DesignVersion {
  if (ENV_OVERRIDE) return ENV_OVERRIDE;
  if (query?.get("v5") === "1") return "v5";
  if (query?.get("v4") === "1") return "v4";
  if (query?.get("v3") === "1") return "v3";
  if (query?.get("v2") === "1") return "v2";
  return "v1";
}
