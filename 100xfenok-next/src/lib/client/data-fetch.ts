/**
 * Shared client-side JSON fetch layer.
 *
 * One in-flight request per URL, joined by every caller regardless of how
 * many components mount at once, plus a success-only TTL cache. A caller's
 * own AbortSignal or timeoutMs only ends that caller's wait -- it never
 * aborts the underlying request, which keeps running and still fills the
 * cache for the next caller (see commit 6530a1e685 for the bug this avoids).
 */
import { recordServing } from "../evidence/provenance";

export type DataFetchErrorKind = "http" | "auth" | "timeout" | "network" | "parse" | "aborted";

export class DataFetchError extends Error {
  readonly url: string;
  readonly kind: DataFetchErrorKind;
  readonly status: number | null;

  constructor(url: string, kind: DataFetchErrorKind, status: number | null, message?: string) {
    super(message ?? `${kind}${status ? ` (${status})` : ""}: ${url}`);
    this.name = "DataFetchError";
    this.url = url;
    this.kind = kind;
    this.status = status;
  }
}

export type DataFetchOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  ttlMs?: number;
  force?: boolean;
  init?: Pick<RequestInit, "cache">;
};

type Loaded<T> = { data: T; receivedAt: number };

const DEFAULT_TTL_MS = 300_000;
const HARD_LIMIT_MS = 30_000;
const LRU_CAP = 64;

const cache = new Map<string, Loaded<unknown>>();
const inflight = new Map<string, Promise<Loaded<unknown>>>();

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function recordServingSafe(url: string, headers: Headers): void {
  try {
    recordServing(url, headers);
  } catch {
    // provenance is best-effort; never let it fail a fetch
  }
}

async function rawFetch<T>(url: string, init: Pick<RequestInit, "cache"> | undefined, signal: AbortSignal): Promise<Loaded<T>> {
  let response: Response;
  try {
    response = await fetch(url, { signal, cache: init?.cache });
  } catch (err) {
    if (isAbortError(err)) throw new DataFetchError(url, "aborted", null);
    throw new DataFetchError(url, "network", null, err instanceof Error ? err.message : String(err));
  }
  recordServingSafe(url, response.headers);
  if (!response.ok) {
    // Release the unread body (it otherwise holds the connection open).
    // cancel() may throw or return a rejecting promise; neither may escape.
    try {
      void Promise.resolve(response.body?.cancel()).catch(() => {});
    } catch {
      // best effort
    }
    throw new DataFetchError(url, response.status === 401 || response.status === 403 ? "auth" : "http", response.status);
  }
  try {
    return { data: (await response.json()) as T, receivedAt: Date.now() };
  } catch (err) {
    throw new DataFetchError(url, "parse", response.status, err instanceof Error ? err.message : String(err));
  }
}

function getCache<T>(url: string): Loaded<T> | null {
  const entry = cache.get(url);
  if (!entry) return null;
  cache.delete(url);
  cache.set(url, entry); // bump recency for the LRU cap
  return entry as Loaded<T>;
}

function setCache(url: string, entry: Loaded<unknown>): void {
  cache.delete(url);
  cache.set(url, entry);
  if (cache.size > LRU_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Owns the network request: one per URL, its own hard limit, success-only cache fill. */
function getOrStartShared<T>(url: string, init: Pick<RequestInit, "cache"> | undefined): Promise<Loaded<T>> {
  const existing = inflight.get(url);
  if (existing) return existing as Promise<Loaded<T>>;

  const controller = new AbortController();
  let hardTimedOut = false;
  const hardTimer = setTimeout(() => {
    hardTimedOut = true;
    controller.abort();
  }, HARD_LIMIT_MS);

  const promise = rawFetch<T>(url, init, controller.signal)
    .then((result) => {
      setCache(url, result);
      return result;
    })
    .catch((err) => {
      if (hardTimedOut && err instanceof DataFetchError && err.kind === "aborted") {
        throw new DataFetchError(url, "timeout", null, err.message);
      }
      throw err;
    })
    .finally(() => {
      clearTimeout(hardTimer);
      inflight.delete(url);
    });

  inflight.set(url, promise);
  return promise;
}

/** Detaches this caller's wait from the shared request: early-out never aborts it. */
function joinShared<T>(shared: Promise<Loaded<T>>, url: string, signal: AbortSignal | undefined, timeoutMs: number | undefined): Promise<Loaded<T>> {
  if (!signal && !timeoutMs) return shared;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      run();
    };
    const onAbort = () => finish(() => reject(new DataFetchError(url, "aborted", null)));
    const timer = timeoutMs !== undefined ? setTimeout(() => finish(() => reject(new DataFetchError(url, "timeout", null))), timeoutMs) : undefined;
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort);
    shared.then(
      (value) => finish(() => resolve(value)),
      (err) => finish(() => reject(err)),
    );
  });
}

/** No shared module state on the server: isolates are shared across users there. */
async function serverFetch<T>(url: string, o: DataFetchOptions): Promise<Loaded<T>> {
  const controller = new AbortController();
  let callerAborted = false;
  const onAbort = () => {
    callerAborted = true;
    controller.abort();
  };
  if (o.signal?.aborted) onAbort();
  else o.signal?.addEventListener("abort", onAbort);
  const hardTimer = setTimeout(() => controller.abort(), HARD_LIMIT_MS);
  const callerTimer = o.timeoutMs !== undefined ? setTimeout(() => controller.abort(), o.timeoutMs) : undefined;
  try {
    return await rawFetch<T>(url, o.init, controller.signal);
  } catch (err) {
    if (!callerAborted && err instanceof DataFetchError && err.kind === "aborted") {
      throw new DataFetchError(url, "timeout", null, err.message);
    }
    throw err;
  } finally {
    clearTimeout(hardTimer);
    if (callerTimer !== undefined) clearTimeout(callerTimer);
    o.signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchJsonShared<T>(url: string, o: DataFetchOptions = {}): Promise<Loaded<T>> {
  if (typeof window === "undefined") return serverFetch<T>(url, o);

  if (!o.force) {
    const cached = getCache<T>(url);
    const ttlMs = o.ttlMs ?? DEFAULT_TTL_MS;
    if (cached && Date.now() - cached.receivedAt < ttlMs) return cached;
  }

  const shared = getOrStartShared<T>(url, o.init);
  return joinShared(shared, url, o.signal, o.timeoutMs);
}

export async function fetchJsonOrNull<T>(url: string, o?: DataFetchOptions): Promise<T | null> {
  try {
    return (await fetchJsonShared<T>(url, o)).data;
  } catch {
    return null;
  }
}

export function invalidateData(url: string): void {
  cache.delete(url);
}
