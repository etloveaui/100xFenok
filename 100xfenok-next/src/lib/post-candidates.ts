// Shared, EDGE-SAFE posts bridge path logic.
//
// Keep this module free of `node:fs` and imports that can reach it. The server
// page and edge middleware must share candidate order without sharing their
// runtime-specific existence checks.

/**
 * Ordered public/posts-raw-relative candidates for a `/posts/<slug...>` request.
 *
 * Order is contractual and reproduces the original posts resolver:
 *   1. `<joined>.html` (or `<joined>` when it already ends in `.html`)
 *   2. `<joined>/index.html`
 */
export function resolvePostCandidates(slug: string[]): string[] {
  const joined = slug.join("/");
  const candidates = joined.endsWith(".html")
    ? [joined]
    : [`${joined}.html`, `${joined}/index.html`];

  return candidates.map((candidate) =>
    candidate.replace(/^\/+/, "").replaceAll("\\", "/"),
  );
}
