// cloud-data-plane-s3.mjs — S3 (SigV4) client for the fenok-data-plane R2 bucket.
// Revision 2 (fh-598): token-derived credentials IN MEMORY, no secret configuration;
// approved endpoints only; fetch timeout AND retry sleep clamped to the shared
// remaining deadline; GetObject surfaces response identity for snapshot checks.
//
// Credentials are derived from the existing CLOUDFLARE_API_TOKEN exactly as verified
// by the parent: the token-verify endpoint yields the token id (S3 access key id) and
// the S3 secret is the SHA-256 of the token value. Nothing is written anywhere and no
// derived material is ever logged, echoed or included in errors.
//
// Endpoint constraints: requests go ONLY to
//   - https://api.cloudflare.com/client/v4/user/tokens/verify (derivation), and
//   - https://<account id>.r2.cloudflarestorage.com/<bucket> (the approved bucket).
// There is deliberately no environment override for the S3 endpoint; a derived key
// must never be sent to an arbitrary host.
//
// Retry/deadline policy is shared with cloudflare-rate-limit.mjs: network/5xx get
// bounded attempts with exponential backoff; HTTP 429/503 honour Retry-After with a
// bounded window; every attempt is capped by min(configured timeout, remaining
// deadline) and every retry sleep is refused when it would consume the deadline.

import { createHash, createHmac } from "node:crypto";

import {
  BACKOFF_BASE_MS,
  MAX_ATTEMPTS,
  MAX_RATE_LIMIT_ATTEMPTS,
  rateLimitDelayMs,
  retryAfterMs,
  sleep,
} from "./cloudflare-rate-limit.mjs";

export const S3_REQUEST_TIMEOUT_MS = 60_000;
export const S3_DELETE_MAX_KEYS = 1000;
export const S3_LIST_PAGE_MAX_KEYS = 1000;
export const R2_S3_BUCKET = "fenok-data-plane";
export const TOKEN_VERIFY_URL = "https://api.cloudflare.com/client/v4/user/tokens/verify";
const DEADLINE_MARGIN_MS = 250;

export class S3ClientError extends Error {
  constructor(code, detail) {
    super(`${code}:${detail}`);
    this.code = code;
  }
}

function fail(code, detail) {
  throw new S3ClientError(code, detail);
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

export function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;",
  })[c]);
}

export function xmlUnescape(value) {
  return String(value).replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ({
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'",
  })[e]);
}

function encodePath(path) {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function canonicalQuery(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
}

function amzTimestamps(date) {
  const iso = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amz: iso, short: iso.slice(0, 8) };
}

function signingKey(secretAccessKey, shortDate, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, shortDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

// --- token-derived credentials (in memory only) --------------------------------

// GET the user-token verify endpoint and derive { accessKeyId, secretAccessKey }.
// The parent verified this endpoint with the existing token; a non-success answer or
// any non-200 status fails closed. The token value and the derived id never appear in
// the error text.
export async function deriveS3CredentialsFromToken({ token, fetchImpl = fetch, timeoutMs = S3_REQUEST_TIMEOUT_MS }) {
  if (typeof token !== "string" || token.length === 0) {
    fail("S3_CONFIG_INVALID", "CLOUDFLARE_API_TOKEN is required for in-memory credential derivation");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let body;
  try {
    response = await fetchImpl(TOKEN_VERIFY_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    body = await response.text();
  } catch (error) {
    fail("S3_TOKEN_VERIFY_FAILED", controller.signal.aborted ? "verify request timed out" : String(error?.message ?? error).slice(0, 200));
  } finally {
    clearTimeout(timer);
  }
  if (response.status !== 200) fail("S3_TOKEN_VERIFY_FAILED", `verify http ${response.status}`);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    fail("S3_TOKEN_VERIFY_FAILED", "verify response is not JSON");
  }
  const id = parsed?.result?.id;
  const status = parsed?.result?.status;
  if (parsed?.success !== true || typeof id !== "string" || id.length === 0) {
    fail("S3_TOKEN_VERIFY_FAILED", "verify response did not carry a token id");
  }
  if (status !== "active") fail("S3_TOKEN_NOT_ACTIVE", String(status));
  return { accessKeyId: id, secretAccessKey: sha256Hex(new TextEncoder().encode(token)) };
}

// --- pure response parsers (exported for the retention safety suite) ----------

// ListObjectsV2 page → { entries, isTruncated, nextContinuationToken }.
// Entries keep null for absent fields; callers validate completeness and fail closed.
export function parseListObjectsV2Xml(xml) {
  const text = String(xml);
  if (!text.includes("<ListBucketResult")) fail("S3_XML_INVALID", "list response is not a ListBucketResult");
  const entries = [];
  const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match;
  while ((match = contentsRe.exec(text)) !== null) {
    const block = match[1];
    const pick = (tag) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return m ? xmlUnescape(m[1]) : null;
    };
    const sizeText = pick("Size");
    const etagText = pick("ETag");
    entries.push({
      key: pick("Key"),
      size: sizeText !== null && /^\d+$/.test(sizeText) ? Number(sizeText) : null,
      etag: etagText !== null ? etagText.replace(/^"|"$/g, "") : null,
      last_modified: pick("LastModified"),
    });
  }
  const truncation = [...text.matchAll(/<IsTruncated>\s*(true|false)\s*<\/IsTruncated>/g)];
  const keyCount = text.match(/<KeyCount>(\d+)<\/KeyCount>/);
  if (!text.trimEnd().endsWith("</ListBucketResult>") || truncation.length !== 1 || !keyCount || Number(keyCount[1]) !== entries.length) fail("S3_XML_INVALID", "incomplete listing page");
  const truncated = truncation[0][1] === "true";
  const tokenMatch = text.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
  return {
    entries,
    isTruncated: truncated,
    nextContinuationToken: tokenMatch ? xmlUnescape(tokenMatch[1]) : null,
  };
}

// DeleteObjects response → per-key classification. A submitted key that appears in
// neither <Deleted> nor <Error> is reported as UNKNOWN (never counted as success).
export function parseDeleteObjectsXml(xml, submittedKeys) {
  const text = String(xml);
  if (!text.includes("<DeleteResult")) fail("S3_XML_INVALID", "delete response is not a DeleteResult");
  const deleted = [];
  const errors = [];
  const deletedRe = /<Deleted>([\s\S]*?)<\/Deleted>/g;
  let match;
  while ((match = deletedRe.exec(text)) !== null) {
    const keyMatch = match[1].match(/<Key>([\s\S]*?)<\/Key>/);
    if (keyMatch) deleted.push(xmlUnescape(keyMatch[1]));
  }
  const errorRe = /<Error>([\s\S]*?)<\/Error>/g;
  while ((match = errorRe.exec(text)) !== null) {
    const block = match[1];
    const pick = (tag) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return m ? xmlUnescape(m[1]) : null;
    };
    errors.push({ key: pick("Key"), code: pick("Code"), message: pick("Message") });
  }
  const deletedSet = new Set(deleted);
  const errorSet = new Set(errors.map((row) => row.key));
  const unknown = submittedKeys.filter((key) => !deletedSet.has(key) && !errorSet.has(key));
  return { deleted, errors, unknown };
}

// --- client -------------------------------------------------------------------

export function createR2S3Client({
  endpoint,
  accessKeyId,
  secretAccessKey,
  bucket,
  fetchImpl = fetch,
  sleepImpl = sleep,
  timeoutMs = S3_REQUEST_TIMEOUT_MS,
  now = () => Date.now(),
}) {
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    fail("S3_CONFIG_INVALID", "endpoint, accessKeyId, secretAccessKey and bucket are required");
  }
  const host = new URL(endpoint).host;
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : S3_REQUEST_TIMEOUT_MS;
  const region = "auto";
  const service = "s3";

  const remainingMs = (deadline) => (deadline ? deadline - now() : Number.POSITIVE_INFINITY);

  async function boundedSleep(ms, deadline) {
    if (deadline) {
      const remaining = remainingMs(deadline);
      if (remaining <= ms + DEADLINE_MARGIN_MS) fail("S3_DEADLINE", "retry delay would consume the deadline");
    }
    await sleepImpl(ms);
  }

  async function once({ method, key, query, body, contentMd5, deadline }) {
    const remaining = remainingMs(deadline);
    if (remaining <= DEADLINE_MARGIN_MS) fail("S3_DEADLINE", "deadline reached before request");
    const attemptTimeoutMs = Math.max(1, Math.floor(Math.min(effectiveTimeoutMs, remaining - DEADLINE_MARGIN_MS)));
    const canonicalUri = `/${encodePath(bucket)}${key ? `/${encodePath(key)}` : ""}`;
    const payloadHash = sha256Hex(body ?? new Uint8Array(0));
    const { amz, short } = amzTimestamps(new Date(now()));
    const headers = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amz,
      ...(contentMd5 ? { "content-md5": contentMd5 } : {}),
      ...(body && body.length > 0 ? { "content-type": "application/xml" } : {}),
    };
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery(query ?? {}),
      canonicalHeaders,
      signedHeaderNames.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${short}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amz,
      scope,
      sha256Hex(new TextEncoder().encode(canonicalRequest)),
    ].join("\n");
    const signature = createHmac("sha256", signingKey(secretAccessKey, short, region, service))
      .update(stringToSign)
      .digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, `
      + `SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;
    const url = `${endpoint}${canonicalUri}${canonicalQuery(query ?? {}) ? `?${canonicalQuery(query ?? {})}` : ""}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
    let response;
    let responseBody;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { ...headers, authorization },
        ...(body && body.length > 0 ? { body } : {}),
        signal: controller.signal,
      });
      responseBody = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (controller.signal.aborted) {
        throw new S3ClientError("S3_NETWORK", `request timed out after ${attemptTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    return { response, body: responseBody };
  }

  // One logical request: bounded transient retries, Retry-After-aware 429/503 window,
  // deadline checked before every attempt AND every retry sleep. Errors are sanitized
  // (status/code only — no headers, no signatures, no key material).
  async function request(options) {
    let transientAttempts = 0;
    let rateLimitAttempts = 0;
    while (true) {
      if (remainingMs(options.deadline) <= DEADLINE_MARGIN_MS) fail("S3_DEADLINE", "deadline reached before attempt");
      let attempt;
      try {
        attempt = await once(options);
      } catch (error) {
        if (error?.code === "S3_DEADLINE") throw error;
        transientAttempts += 1;
        if (transientAttempts >= MAX_ATTEMPTS) fail("S3_NETWORK", String(error?.message ?? error).slice(0, 300));
        await boundedSleep(BACKOFF_BASE_MS * 2 ** (transientAttempts - 1), options.deadline);
        continue;
      }
      const { response } = attempt;
      if (response.status === 429 || response.status === 503) {
        rateLimitAttempts += 1;
        if (rateLimitAttempts >= MAX_RATE_LIMIT_ATTEMPTS) {
          fail("S3_RATE_LIMIT_EXHAUSTED", `http ${response.status} after ${rateLimitAttempts} attempts`);
        }
        const requested = retryAfterMs(response);
        const delay = response.status === 429 && requested === null
          ? rateLimitDelayMs(response, rateLimitAttempts, options.key ?? "")
          : (requested ?? BACKOFF_BASE_MS * 2 ** (rateLimitAttempts - 1));
        await boundedSleep(delay, options.deadline);
        continue;
      }
      if (response.status >= 500) {
        transientAttempts += 1;
        if (transientAttempts >= MAX_ATTEMPTS) fail("S3_HTTP", `http ${response.status}`);
        await boundedSleep(BACKOFF_BASE_MS * 2 ** (transientAttempts - 1), options.deadline);
        continue;
      }
      return attempt;
    }
  }

  function errorSnippet(body) {
    try {
      return new TextDecoder().decode(body).slice(0, 300).replace(/\s+/g, " ");
    } catch {
      return "<unreadable>";
    }
  }

  return {
    bucket,

    async listAllObjects({ deadline } = {}) {
      const entries = [];
      let token = null;
      let pages = 0;
      const tokens = new Set();
      do {
        if (++pages > 100 || (token && tokens.has(token))) fail("S3_LIST_BUDGET", "listing exceeds declared budget or repeats cursor");
        if (token) tokens.add(token);
        const query = {
          "list-type": "2",
          "max-keys": String(S3_LIST_PAGE_MAX_KEYS),
          ...(token ? { "continuation-token": token } : {}),
        };
        const { response, body } = await request({ method: "GET", key: "", query, deadline });
        if (!response.ok) fail("S3_HTTP", `list http ${response.status}: ${errorSnippet(body)}`);
        const page = parseListObjectsV2Xml(new TextDecoder().decode(body));
        entries.push(...page.entries);
        token = page.isTruncated ? page.nextContinuationToken : null;
        if (page.isTruncated && !token) fail("S3_XML_INVALID", "truncated list page without a continuation token");
      } while (token);
      return entries;
    },

    // Returns { bytes, etag, last_modified } or null (404). The response identity
    // lets callers verify that the bytes match the listing entry they planned on.
    async getObject(key, { deadline } = {}) {
      const { response, body } = await request({ method: "GET", key, deadline });
      if (response.status === 404) return null;
      if (!response.ok) fail("S3_HTTP", `get http ${response.status}: ${errorSnippet(body)}`);
      const etagHeader = response.headers?.get?.("etag") ?? null;
      const lastModifiedHeader = response.headers?.get?.("last-modified") ?? null;
      return {
        bytes: body,
        etag: etagHeader !== null ? String(etagHeader).replace(/^"|"$/g, "") : null,
        last_modified: lastModifiedHeader,
      };
    },

    async deleteObjects(keys, { deadline } = {}) {
      if (!Array.isArray(keys) || keys.length === 0 || keys.length > S3_DELETE_MAX_KEYS) {
        fail("S3_DELETE_SIZE_INVALID", `${keys?.length ?? "?"} keys for one DeleteObjects request`);
      }
      const body = new TextEncoder().encode(
        `<Delete><Quiet>false</Quiet>${keys.map((key) => `<Object><Key>${xmlEscape(key)}</Key></Object>`).join("")}</Delete>`,
      );
      const contentMd5 = createHash("md5").update(body).digest("base64");
      const { response, body: responseBody } = await request({
        method: "POST", key: "", query: { delete: "" }, body, contentMd5, deadline,
      });
      if (!response.ok) fail("S3_HTTP", `delete http ${response.status}: ${errorSnippet(responseBody)}`);
      return parseDeleteObjectsXml(new TextDecoder().decode(responseBody), keys);
    },
  };
}

// Factory used by the ops scripts: derive credentials in memory from the existing
// Cloudflare token and bind the client to the approved endpoint/bucket only.
export async function createR2S3ClientFromExistingToken({
  env = process.env,
  fetchImpl = fetch,
  sleepImpl,
  now,
  timeoutMs,
} = {}) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const missing = [
    ["CLOUDFLARE_API_TOKEN", token],
    ["CLOUDFLARE_ACCOUNT_ID", accountId],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) fail("S3_CONFIG_INVALID", `missing env ${missing.join(", ")}`);
  const { accessKeyId, secretAccessKey } = await deriveS3CredentialsFromToken({ token, fetchImpl, timeoutMs });
  return createR2S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId,
    secretAccessKey,
    bucket: R2_S3_BUCKET,
    fetchImpl,
    sleepImpl,
    now,
    timeoutMs,
  });
}
