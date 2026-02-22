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

  const [withoutHash] = decoded.split("#", 1);
  const [withoutQuery] = withoutHash.split("?", 1);
  const normalized = withoutQuery.trim().replace(/^\/+/, "");

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

  return normalized;
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
  const safeRelativePath = relativePath.replace(/^\/+/, "");
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
