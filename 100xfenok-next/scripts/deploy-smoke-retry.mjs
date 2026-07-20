export const DEPLOY_SMOKE_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 1500;
const DEFAULT_TIMEOUT_MS = 15000;

function checkedInteger(value, fallback, label, minimum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}: ${value}`);
  }
  return parsed;
}

export function isRetryableFetchStatus(status) {
  return Number.isInteger(status) && status >= 500 && status <= 599;
}

function errorChainText(error) {
  const parts = [];
  let current = error;
  while (current && !parts.includes(current)) {
    parts.push(current);
    current = current.cause;
  }
  return parts.map((item) => item?.message ?? String(item)).join(": ");
}

export function isRetryableFetchError(error) {
  const detail = errorChainText(error);
  return !/redirect count exceeded|redirect loop|too many redirects/i.test(detail);
}

export async function fetchTextWithBoundedRetry(url, init = {}, options = {}) {
  const attempts = checkedInteger(options.attempts, DEPLOY_SMOKE_ATTEMPTS, "retry attempts", 1);
  const delayMs = checkedInteger(options.delayMs, DEFAULT_DELAY_MS, "retry delay", 0);
  const timeoutMs = checkedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "request timeout", 1);
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((duration) => new Promise((resolve) => setTimeout(resolve, duration)));
  const label = options.label ?? `${init.method ?? "GET"} ${url}`;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      const text = await response.text();
      const declaredBytes = Number(response.headers.get("content-length"));
      const receivedBytes = Buffer.byteLength(text);
      if (Number.isFinite(declaredBytes) && declaredBytes > 0 && receivedBytes < declaredBytes) {
        throw new Error(
          `${label} body truncated: received ${receivedBytes} of ${declaredBytes} bytes`,
        );
      }
      if (!isRetryableFetchStatus(response.status) || attempt === attempts) {
        return { response, text, attempts: attempt };
      }
      lastError = new Error(`${label} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error?.name === "AbortError"
        ? new Error(`${label} timed out after ${timeoutMs}ms`, { cause: error })
        : error;
      if (!isRetryableFetchError(lastError) || attempt === attempts) throw lastError;
    } finally {
      clearTimeout(timer);
    }

    await sleep(delayMs);
  }

  throw lastError ?? new Error(`${label} failed`);
}
