import { LEGACY_SEGMENT_PATTERN } from "@/lib/admin-legacy-candidates";
import { publicAssetExists } from "@/lib/server/public-assets";

const LEGACY_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;

type SanitizeLegacyPathOptions = {
  prefixes: string[];
  requireHtmlSuffix?: boolean;
};

export function getSingleSearchParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function sanitizeLegacyPath(
  rawPath: string | undefined,
  { prefixes, requireHtmlSuffix = true }: SanitizeLegacyPathOptions,
): string | null {
  if (!rawPath) return null;

  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  const { pathname, suffix } = splitLegacyPathSuffix(decoded);
  const normalized = pathname.trim().replace(/^\/+/, "");

  if (!normalized || normalized.includes("\\")) return null;
  if (!LEGACY_PATH_PATTERN.test(normalized)) return null;
  if (requireHtmlSuffix && !normalized.endsWith(".html")) return null;

  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith(".") ||
        !LEGACY_SEGMENT_PATTERN.test(segment),
    )
  ) {
    return null;
  }

  const matchedPrefix = prefixes.some((prefix) => normalized.startsWith(prefix));
  if (!matchedPrefix) return null;

  return `${normalized}${suffix}`;
}

// Canonical definition lives in the edge-safe module so middleware can apply the
// identical check without importing anything that reaches `node:fs`.
export { isSafeSlugSegments } from "@/lib/admin-legacy-candidates";

export async function legacyPublicFileExists(relativePath: string): Promise<boolean> {
  const { pathname } = splitLegacyPathSuffix(relativePath);
  const safeRelativePath = pathname.replace(/^\/+/, "");
  return publicAssetExists(safeRelativePath);
}

function splitLegacyPathSuffix(value: string): { pathname: string; suffix: string } {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const suffixIndex =
    queryIndex === -1
      ? hashIndex
      : hashIndex === -1
        ? queryIndex
        : Math.min(queryIndex, hashIndex);

  if (suffixIndex === -1) {
    return { pathname: value, suffix: "" };
  }

  return {
    pathname: value.slice(0, suffixIndex),
    suffix: value.slice(suffixIndex),
  };
}
