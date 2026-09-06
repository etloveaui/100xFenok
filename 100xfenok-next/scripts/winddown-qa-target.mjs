/** Authenticated study GETs can initialize storage: method alone is not safety. */
export function assertWindDownQaTarget(baseUrl, isolatedMarker) {
  let target;
  try { target = new URL(baseUrl); } catch { /* fail closed below */ }
  if (
    isolatedMarker !== "1"
    || !target
    || target.protocol !== "http:"
    || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
    || target.username
    || target.password
  ) {
    throw new Error("WINDDOWN_QA_TARGET_UNSAFE: use an explicitly isolated loopback runner");
  }
  return target;
}
