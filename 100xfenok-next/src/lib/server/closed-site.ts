// Closed-site gate helpers: mode, canary preview, and verification token.
// Spec: docs/planning/20260917_closed-site-intro-login-spec.md §2, §5.

import { resolveCurrentSession } from "./authSession";

export type GateMode = "off" | "preview" | "on";

export const CLOSED_SITE_ENV_VAR = "CLOSED_SITE";
export const FENOK_VERIFY_TOKEN_ENV_VAR = "FENOK_VERIFY_TOKEN";
export const FX_PREVIEW_COOKIE_NAME = "fx_preview";
export const VERIFY_HEADER_NAME = "x-fenok-verify";

/**
 * Returns the configured gate mode: "off" | "preview" | "on".
 * Values "on", "1", "true" resolve to "on".
 * Value "preview" resolves to "preview".
 * Default / absent / unrecognized resolves to "off".
 */
export function gateMode(env?: unknown): GateMode {
  const raw = (
    (env as Record<string, unknown> | undefined)?.[CLOSED_SITE_ENV_VAR] ??
    process.env[CLOSED_SITE_ENV_VAR] ??
    ""
  )
    .toString()
    .trim()
    .toLowerCase();

  if (raw === "on" || raw === "1" || raw === "true") {
    return "on";
  }
  if (raw === "preview") {
    return "preview";
  }
  return "off";
}

/**
 * Returns whether a given request is subject to the closed-site gate.
 * - "off": never gated (returns false)
 * - "on": always gated (returns true)
 * - "preview": gated only if the request carries cookie `fx_preview=1`
 */
export function isGated(request: Request, mode: GateMode): boolean {
  if (mode === "off") {
    return false;
  }
  if (mode === "on") {
    return true;
  }
  if (mode === "preview") {
    const cookieHeader =
      request.headers.get("cookie") || request.headers.get("Cookie") || "";
    if (!cookieHeader) return false;
    const cookies = cookieHeader.split(";").map((c) => c.trim());
    return cookies.some(
      (c) =>
        c === `${FX_PREVIEW_COOKIE_NAME}=1` ||
        c.startsWith(`${FX_PREVIEW_COOKIE_NAME}=1;`),
    );
  }
  return false;
}

/**
 * Paths that are always accessible even when the site is closed:
 * - /intro (the intro face / login entrance)
 * - /api/auth/* (Google OAuth exchange & logout handlers)
 * - /_next/* (Next.js assets and chunks)
 * - /api/health (health check endpoints)
 * - Static assets / manifest / robots.txt / sitemap.xml / favicon.ico
 */
export function isAlwaysOpenPath(pathname: string): boolean {
  if (pathname === "/intro" || pathname.startsWith("/intro/")) {
    return true;
  }
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
    return true;
  }
  if (pathname.startsWith("/_next/")) {
    return true;
  }
  if (pathname === "/api/health" || pathname.startsWith("/api/health/")) {
    return true;
  }
  if (
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/manifest.json"
  ) {
    return true;
  }
  return false;
}

/**
 * Generates an HMAC-SHA256 hex signature using WebCrypto.
 */
export async function generateVerifySignature(
  token: string,
  dateStr: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token.trim()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(dateStr.trim()),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verifies the `x-fenok-verify` header against HMAC-SHA256 of the UTC date YYYY-MM-DD
 * (today or yesterday, to survive midnight crossing) keyed by the secret token.
 * WebCrypto only.
 */
export async function verifyRequestToken(
  request: Request,
  verifyToken?: string,
  nowInput?: number | Date,
): Promise<boolean> {
  const token =
    verifyToken?.trim() ||
    process.env[FENOK_VERIFY_TOKEN_ENV_VAR]?.trim() ||
    "";
  if (!token) return false;

  const headerValue =
    request.headers.get(VERIFY_HEADER_NAME) ||
    request.headers.get("x-fenok-verify") ||
    "";
  const trimmedHeader = headerValue.trim().toLowerCase();
  if (!trimmedHeader || trimmedHeader.length !== 64) {
    return false;
  }

  const now = nowInput instanceof Date ? nowInput : new Date(nowInput ?? Date.now());
  const todayStr = now.toISOString().slice(0, 10);
  const yesterdayStr = new Date(now.getTime() - 86400000)
    .toISOString()
    .slice(0, 10);

  try {
    const todaySig = await generateVerifySignature(token, todayStr);
    if (constantTimeEqual(trimmedHeader, todaySig)) {
      return true;
    }
    const yesterdaySig = await generateVerifySignature(token, yesterdayStr);
    if (constantTimeEqual(trimmedHeader, yesterdaySig)) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Evaluates the closed-site gate for the worker layer (specifically /data/* and /api/data/*).
 * Returns a 401 Response when denied, or null when the request is allowed to proceed.
 */
export async function handleWorkerClosedSiteGate(
  request: Request,
  env?: unknown,
): Promise<Response | null> {
  const mode = gateMode(env);
  if (!isGated(request, mode)) {
    return null;
  }

  const url = new URL(request.url);
  if (url.pathname.startsWith("/data/") || url.pathname.startsWith("/api/data/")) {
    const verifyToken = (env as Record<string, unknown> | undefined)?.[
      FENOK_VERIFY_TOKEN_ENV_VAR
    ] as string | undefined;
    const hasVerify = await verifyRequestToken(request, verifyToken);
    if (hasVerify) {
      return null;
    }

    let session = null;
    try {
      session = await resolveCurrentSession(request, env);
    } catch {
      session = null;
    }
    if (session) {
      return null;
    }

    return new Response(JSON.stringify({ ok: false, error: "login required" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  return null;
}
