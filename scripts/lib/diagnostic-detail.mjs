const DEFAULT_LIMIT = 320;

function redactUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}${parsed.search ? "?[redacted]" : ""}`;
  } catch {
    return "[redacted-url]";
  }
}

export function boundedDiagnosticDetail(error, limit = DEFAULT_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1 || limit > DEFAULT_LIMIT) {
    throw new TypeError(`diagnostic detail limit must be within 1..${DEFAULT_LIMIT}`);
  }
  if (!error) return null;
  const name = String(error?.name || error?.constructor?.name || "Error")
    .replaceAll(/[^A-Za-z0-9_.-]/g, "")
    || "Error";
  let message = String(error?.message ?? error)
    .replaceAll(/[\u0000-\u001f\u007f]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  message = message
    .replaceAll(/https?:\/\/[^\s),;]+/gi, (url) => redactUrl(url))
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    // The label is allowed to carry prefixes and suffixes. `\b` does not fire
    // inside `client_secret` because `_` is a word character, so a bare-word
    // pattern silently misses exactly the credential this repo uses for FINRA
    // OAuth. Over-redacting a log line costs nothing; leaking one costs
    // everything, so any token-ish label matches however it is decorated.
    .replaceAll(
      /([A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?token|client[_-]?secret|token|secret|key|authorization|cookie|password)[A-Za-z0-9_-]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[redacted]",
    )
    .replace(/\b(body|payload|response)\b\s*[:=]\s*.+$/i, "$1: [redacted]");
  if (name === "SyntaxError") {
    message = message.replaceAll(/"[^"]*"/g, '"[redacted]"');
  }
  return `${name}: ${message || "no message"}`.slice(0, limit);
}

export function diagnosticSuffix(detail) {
  return detail ? `; error: ${detail}` : "";
}
