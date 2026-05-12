/**
 * Design version detection helpers.
 *
 * - Server: read from URL `?v2=1` / `?v3=1` (via `searchParams` prop)
 * - Client: read from `useSearchParams()` or env override
 *
 * Default = 'v1' (existing dashboard, unchanged).
 * 'v2' = Claude Design V2 handoff (P0+P1+P2 audit fixes, gated rollout).
 * 'v3' = Claude Design V3-C Watch & Alert (pins + alerts + localStorage, gated rollout).
 */

export type DesignVersion = "v1" | "v2" | "v3" | "v4";

const ENV_OVERRIDE: DesignVersion | null =
  process.env.NEXT_PUBLIC_DESIGN_V4 === "1"
    ? "v4"
    : process.env.NEXT_PUBLIC_DESIGN_V3 === "1"
      ? "v3"
      : process.env.NEXT_PUBLIC_DESIGN_V2 === "1"
        ? "v2"
        : null;

function pickFromParam(raw: string | string[] | undefined): "v3" | "v2" | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "1" ? null : null;
}

/**
 * Server-side helper. Pass the awaited searchParams from a server component.
 */
export function getDesignVersionFromSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): DesignVersion {
  if (ENV_OVERRIDE) return ENV_OVERRIDE;
  const v4Raw = searchParams?.v4;
  const v4Value = Array.isArray(v4Raw) ? v4Raw[0] : v4Raw;
  if (v4Value === "1") return "v4";
  const v3Raw = searchParams?.v3;
  const v3Value = Array.isArray(v3Raw) ? v3Raw[0] : v3Raw;
  if (v3Value === "1") return "v3";
  const v2Raw = searchParams?.v2;
  const v2Value = Array.isArray(v2Raw) ? v2Raw[0] : v2Raw;
  if (v2Value === "1") return "v2";
  // suppress unused warning for typing helper
  void pickFromParam;
  return "v1";
}

/**
 * Client-side helper. Pass `useSearchParams()` result.
 */
export function getDesignVersionFromQuery(
  query: URLSearchParams | null | undefined,
): DesignVersion {
  if (ENV_OVERRIDE) return ENV_OVERRIDE;
  if (query?.get("v4") === "1") return "v4";
  if (query?.get("v3") === "1") return "v3";
  if (query?.get("v2") === "1") return "v2";
  return "v1";
}
