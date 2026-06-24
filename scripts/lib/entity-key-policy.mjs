export const ENTITY_KEY_POLICY = Object.freeze({
  stock: "ticker:<UPPERCASE_SYMBOL>",
  etf: "etf:<UPPERCASE_SYMBOL>",
  sector: "sector:<CANONICAL_GICS_LABEL>",
  etf_category: "etf_category:<CATEGORY_LABEL>",
  filing: "filing:<UPPERCASE_SYMBOL>",
  sec13f: "sec13f:<UPPERCASE_SYMBOL>",
});

const ENTITY_KEY_PREFIX = Object.freeze({
  stock: "ticker",
  etf: "etf",
  sector: "sector",
  etf_category: "etf_category",
  filing: "filing",
  sec13f: "sec13f",
});

const PREFIX_TO_KIND = Object.freeze(Object.fromEntries(
  Object.entries(ENTITY_KEY_PREFIX).map(([kind, prefix]) => [prefix, kind]),
));

export function normalizeEntitySymbol(value) {
  return String(value || "").trim().toUpperCase();
}

export function normalizeEntityLabel(value) {
  return String(value || "").trim();
}

export function makeEntityKey(kind, value) {
  const prefix = ENTITY_KEY_PREFIX[kind];
  if (!prefix) throw new Error(`unknown entity key kind: ${kind}`);
  const normalized = kind === "sector" || kind === "etf_category"
    ? normalizeEntityLabel(value)
    : normalizeEntitySymbol(value);
  if (!normalized) return null;
  return `${prefix}:${normalized}`;
}

export function parseEntityKey(key) {
  const text = String(key || "");
  const index = text.indexOf(":");
  if (index <= 0 || index === text.length - 1) return null;
  const prefix = text.slice(0, index);
  const value = text.slice(index + 1);
  const kind = PREFIX_TO_KIND[prefix];
  return kind ? { kind, prefix, value } : null;
}

function validSymbol(value) {
  return /^[A-Z0-9][A-Z0-9.-]*$/.test(value);
}

function validLabel(value) {
  return value.length > 0 && !/[\r\n]/.test(value);
}

export function isValidEntityKey(kind, key) {
  const parsed = parseEntityKey(key);
  if (!parsed || parsed.kind !== kind) return false;
  if (kind === "sector" || kind === "etf_category") return validLabel(parsed.value);
  return validSymbol(parsed.value);
}

export function expectedEntityKeyPolicy() {
  return { ...ENTITY_KEY_POLICY };
}
