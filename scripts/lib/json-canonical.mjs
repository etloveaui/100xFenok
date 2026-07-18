// Canonical JSON serialization, shared leaf module.
//
// Extracted from scripts/lib/data-supply-detection-config.mjs so the detection
// config can import the lane registry WITHOUT a circular import
// (config -> lane-registry -> this leaf). The detection config re-exports
// canonicalJson, so existing importers see no change. Error text is preserved
// byte-for-byte for the same reason.

function fail(message) {
  throw new TypeError(`invalid data-supply detection config: ${message}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value, stack) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical JSON rejects non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (stack.has(value)) fail("canonical JSON rejects cycles");
    stack.add(value);
    const result = value.map((entry) => canonicalize(entry, stack));
    stack.delete(value);
    return result;
  }
  if (!isPlainObject(value)) fail("canonical JSON accepts plain JSON objects only");
  if (stack.has(value)) fail("canonical JSON rejects cycles");
  stack.add(value);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry === undefined || typeof entry === "function" || typeof entry === "symbol" || typeof entry === "bigint") {
      fail(`canonical JSON rejects non-JSON value at ${key}`);
    }
    result[key] = canonicalize(entry, stack);
  }
  stack.delete(value);
  return result;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value, new Set()));
}
