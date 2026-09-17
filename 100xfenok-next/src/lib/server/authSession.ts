import {
  type UserProfile,
  type UserSettings,
  type UserStoreApi,
  getInMemoryUserStore,
  TOKEN_TTL_MS,
  TOKEN_REFRESH_THRESHOLD_MS,
} from "./userStore";

export const FX_SESSION_COOKIE_NAME = "fx_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const DEFAULT_GOOGLE_CLIENT_ID =
  "435404551214-fv2t9dtg0h1rbcndc225329no5ibrrcu.apps.googleusercontent.com";

export interface GooglePayload {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  aud?: string;
}

export interface GoogleIdTokenVerifier {
  verify(idToken: string, clientId?: string): Promise<GooglePayload | null>;
}

export const defaultGoogleVerifier: GoogleIdTokenVerifier = {
  async verify(idToken: string, clientId?: string): Promise<GooglePayload | null> {
    try {
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      if (typeof data.sub !== "string" || typeof data.email !== "string") return null;
      const targetClientId = clientId || DEFAULT_GOOGLE_CLIENT_ID;
      if (targetClientId && data.aud !== targetClientId) {
        return null;
      }
      return {
        sub: data.sub,
        email: data.email,
        name: typeof data.name === "string" ? data.name : undefined,
        picture: typeof data.picture === "string" ? data.picture : undefined,
        aud: typeof data.aud === "string" ? data.aud : undefined,
      };
    } catch {
      return null;
    }
  },
};

let customGoogleVerifier: GoogleIdTokenVerifier | null = null;

export function setCustomGoogleVerifier(verifier: GoogleIdTokenVerifier | null): void {
  customGoogleVerifier = verifier;
}

export function getGoogleVerifier(): GoogleIdTokenVerifier {
  return customGoogleVerifier ?? defaultGoogleVerifier;
}

export interface ParsedSessionToken {
  sub: string;
  secret: string;
  rawToken: string;
  source: "cookie" | "bearer";
}

/**
 * Extracts session token from Cookie (`fx_session`) or `Authorization: Bearer <token>`.
 * Token structure: `<sub: string>.<secret: string>`.
 */
export function parseSessionToken(request: Request): ParsedSessionToken | null {
  // 1. Check Cookie first
  const cookieHeader = request.headers.get("Cookie") || request.headers.get("cookie") || "";
  if (cookieHeader) {
    const cookies = cookieHeader.split(";").map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith(`${FX_SESSION_COOKIE_NAME}=`)) {
        const rawToken = c.slice(`${FX_SESSION_COOKIE_NAME}=`.length).trim();
        const parsed = splitToken(rawToken);
        if (parsed) {
          return { ...parsed, rawToken, source: "cookie" };
        }
      }
    }
  }

  // 2. Check Authorization Bearer
  const authHeader = request.headers.get("Authorization") || request.headers.get("authorization") || "";
  if (authHeader.trim().toLowerCase().startsWith("bearer ")) {
    const rawToken = authHeader.trim().slice(7).trim();
    const parsed = splitToken(rawToken);
    if (parsed) {
      return { ...parsed, rawToken, source: "bearer" };
    }
  }

  return null;
}

function splitToken(token: string): { sub: string; secret: string } | null {
  if (!token) return null;
  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0 || dotIndex === token.length - 1) return null;
  const sub = token.slice(0, dotIndex);
  const secret = token.slice(dotIndex + 1);
  return { sub, secret };
}

export function createSessionCookieHeader(
  token: string,
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS,
): string {
  return `${FX_SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function createClearSessionCookieHeader(): string {
  return `${FX_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): unknown;
}

export async function resolveUserStore(
  sub: string,
  explicitEnv?: unknown,
): Promise<UserStoreApi> {
  let env = explicitEnv;
  if (!env) {
    try {
      const mod = await import("@opennextjs/cloudflare");
      const ctx = await mod.getCloudflareContext({ async: true });
      env = ctx.env;
    } catch {
      // Node.js or unit test environment where @opennextjs/cloudflare is unavailable or throws
    }
  }

  const userNamespace = (env as Record<string, unknown> | undefined)?.USER_STORE as
    | DurableObjectNamespaceLike
    | undefined;

  if (
    userNamespace &&
    typeof userNamespace.idFromName === "function" &&
    typeof userNamespace.get === "function"
  ) {
    const id = userNamespace.idFromName(`user:${sub}`);
    return userNamespace.get(id) as UserStoreApi;
  }

  // Fallback to in-memory store for Node / testing / local dev
  return getInMemoryUserStore(sub);
}

export interface SessionResult {
  sub: string;
  user: UserProfile;
  store: UserStoreApi;
  token: string;
  source: "cookie" | "bearer";
}

/**
 * Validates the session from Cookie or Bearer header, checking token hash in UserStore.
 */
export async function resolveCurrentSession(
  request: Request,
  env?: unknown,
  now?: number,
): Promise<SessionResult | null> {
  const parsed = parseSessionToken(request);
  if (!parsed) return null;

  const store = await resolveUserStore(parsed.sub, env);
  const isValid = await store.verifyToken(parsed.secret, now);
  if (!isValid) return null;

  const user = await store.getProfile();
  if (!user) return null;

  return {
    sub: parsed.sub,
    user,
    store,
    token: parsed.rawToken,
    source: parsed.source,
  };
}
