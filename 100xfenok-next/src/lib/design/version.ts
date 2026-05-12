/**
 * Design version detection helpers.
 *
 * - Server: read from URL `?v2=1` (via `searchParams` prop)
 * - Client: read from `useSearchParams()` or env override
 *
 * Default = 'v1' (existing dashboard, unchanged).
 * 'v2' = Claude Design handoff implementation (gated, parallel rollout).
 */

export type DesignVersion = "v1" | "v2";

const ENV_OVERRIDE: DesignVersion | null =
  process.env.NEXT_PUBLIC_DESIGN_V2 === "1" ? "v2" : null;

/**
 * Server-side helper. Pass the awaited searchParams from a server component.
 */
export function getDesignVersionFromSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): DesignVersion {
  if (ENV_OVERRIDE) return ENV_OVERRIDE;
  const raw = searchParams?.v2;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "1" ? "v2" : "v1";
}

/**
 * Client-side helper. Pass `useSearchParams()` result.
 */
export function getDesignVersionFromQuery(
  query: URLSearchParams | null | undefined,
): DesignVersion {
  if (ENV_OVERRIDE) return ENV_OVERRIDE;
  return query?.get("v2") === "1" ? "v2" : "v1";
}
