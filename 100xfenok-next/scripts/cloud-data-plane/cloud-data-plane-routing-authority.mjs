// Single source of truth for the selective Cloudflare asset-to-Worker boundary.
//
// Private deny paths are derived from the generated registry output, with the
// isolated Griffin exception kept explicit. Public Worker-first families are
// derived from the generated enrollment authority so a newly enrolled family
// cannot silently bypass the data-plane read path or its fallback contract.

import {
  PLANE_ENROLLMENT_EXACT,
  PLANE_ENROLLMENT_PRIVATE_DENY,
  PLANE_ENROLLMENT_PREFIXES,
} from "./cloud-data-plane-enrollment.generated.mjs";

const EXPLICIT_PRIVATE_PATH_VALUES = Object.freeze([
  "/data/sec-13f/investors/griffin.json",
]);
export const PRIVATE_PUBLIC_PATH_VALUES = Object.freeze([
  ...new Set([...PLANE_ENROLLMENT_PRIVATE_DENY, ...EXPLICIT_PRIVATE_PATH_VALUES]),
].sort());
const PRIVATE_PUBLIC_PATH_SET = new Set(PRIVATE_PUBLIC_PATH_VALUES);

// Keep the mutating Set private to this module. Callers receive a frozen
// authority with the one operation the Worker needs, so the deny boundary
// cannot be changed by a consumer at runtime.
export const PRIVATE_PUBLIC_PATHS = Object.freeze({
  has(pathname) {
    return PRIVATE_PUBLIC_PATH_SET.has(pathname);
  },
});

function familyRootPattern(pathname, label) {
  const match = /^\/data\/([^/]+)(?:\/|$)/u.exec(pathname);
  if (!match) throw new Error(`invalid ${label} enrollment path: ${pathname}`);
  return `/data/${match[1]}/*`;
}

function coversPath(pattern, pathname) {
  return pattern.endsWith("*")
    ? pathname.startsWith(pattern.slice(0, -1))
    : pattern === pathname;
}

export function deriveWorkerFirstPatterns(
  exact = PLANE_ENROLLMENT_EXACT,
  prefixes = PLANE_ENROLLMENT_PREFIXES,
) {
  const familyPatterns = new Set();
  for (const [pathname] of exact) familyPatterns.add(familyRootPattern(pathname, "exact"));
  for (const { prefix } of prefixes) familyPatterns.add(familyRootPattern(prefix, "prefix"));

  const sortedFamilies = [...familyPatterns].sort();
  const isolatedPrivatePaths = PRIVATE_PUBLIC_PATH_VALUES
    .filter((pathname) => !sortedFamilies.some((pattern) => coversPath(pattern, pathname)))
    .sort();
  return Object.freeze([...sortedFamilies, ...isolatedPrivatePaths]);
}

export const FINAL_WORKER_FIRST_PATTERNS = deriveWorkerFirstPatterns();
