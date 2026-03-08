import fs from "node:fs";
import path from "node:path";

const LEGACY_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const LEGACY_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

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

export function isSafeSlugSegments(slug: string[]): boolean {
  return slug.every(
    (segment) =>
      !!segment &&
      !segment.includes("/") &&
      !segment.includes("\\") &&
      !segment.includes("..") &&
      !segment.startsWith(".") &&
      LEGACY_SEGMENT_PATTERN.test(segment),
  );
}

export function legacyPublicFileExists(relativePath: string): boolean {
  const publicRoot = path.resolve(process.cwd(), "public");
  const { pathname } = splitLegacyPathSuffix(relativePath);
  const safeRelativePath = pathname.replace(/^\/+/, "");
  const absolutePath = path.resolve(publicRoot, safeRelativePath);

  if (
    absolutePath !== publicRoot &&
    !absolutePath.startsWith(`${publicRoot}${path.sep}`)
  ) {
    return false;
  }
  if (!fs.existsSync(absolutePath)) return false;
  return fs.statSync(absolutePath).isFile();
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
