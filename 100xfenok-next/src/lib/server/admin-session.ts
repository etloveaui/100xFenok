export const ADMIN_SESSION_COOKIE = "fenok_admin_session";
export const ADMIN_SESSION_DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30;
export const ADMIN_SESSION_MAX_TTL_MS = ADMIN_SESSION_DEFAULT_TTL_MS;
export const ADMIN_SESSION_TTL_MS = ADMIN_SESSION_DEFAULT_TTL_MS;

const DEFAULT_ADMIN_PASSWORD_HASH =
  "8736ca6f3957409305f60068e93215c85f8751e4dcdc9303832b325a72c7789f";
const DEFAULT_ADMIN_SESSION_SECRET =
  `${DEFAULT_ADMIN_PASSWORD_HASH}:fenok-admin-v1`;

type AdminSessionPayload = {
  exp: number;
  iat: number;
  v: 1;
};

function getAdminPasswordHash(): string {
  const configured = process.env.NEXT_ADMIN_PASSWORD_HASH;
  if (configured) return configured;
  if (isDefaultAdminAuthAllowed()) return DEFAULT_ADMIN_PASSWORD_HASH;
  return "";
}

function getAdminSessionSecret(): string {
  const configured = process.env.NEXT_ADMIN_SESSION_SECRET;
  if (configured) return configured;
  if (isDefaultAdminAuthAllowed()) return DEFAULT_ADMIN_SESSION_SECRET;
  return "";
}

export function isDefaultAdminAuthAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function isLocalAdminBypassEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function isAdminAuthConfigured(): boolean {
  return Boolean(getAdminPasswordHash() && getAdminSessionSecret());
}

function finitePositiveNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getAdminSessionTtlMs(): number {
  const configuredHours = finitePositiveNumber(process.env.NEXT_ADMIN_SESSION_TTL_HOURS);
  if (!configuredHours) return ADMIN_SESSION_DEFAULT_TTL_MS;
  return Math.min(
    Math.round(configuredHours * 60 * 60 * 1000),
    ADMIN_SESSION_MAX_TTL_MS,
  );
}

export function getAdminSessionRevokedBeforeMs(): number {
  const configuredMs = finitePositiveNumber(process.env.NEXT_ADMIN_SESSION_REVOKED_BEFORE_MS);
  if (configuredMs) return Math.floor(configuredMs);

  const configuredIso = process.env.NEXT_ADMIN_SESSION_REVOKED_BEFORE;
  if (!configuredIso) return 0;
  const parsed = Date.parse(configuredIso);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const value = btoa(binary);
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return bytesToHex(digest);
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return bytesToHex(signature);
}

function serializePayload(payload: AdminSessionPayload): string {
  return bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
}

function parsePayload(encoded: string): AdminSessionPayload | null {
  try {
    const decoded = new TextDecoder().decode(base64UrlToBytes(encoded));
    const parsed = JSON.parse(decoded) as Partial<AdminSessionPayload>;
    if (parsed.v !== 1) return null;
    if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) {
      return null;
    }
    const issuedAt =
      typeof parsed.iat === "number" && Number.isFinite(parsed.iat)
        ? parsed.iat
        : 0;
    return {
      v: 1,
      exp: parsed.exp,
      iat: issuedAt,
    };
  } catch {
    return null;
  }
}

export async function verifyAdminPasswordServer(
  input: string,
): Promise<boolean> {
  const normalized = input.trim();
  if (!normalized) return false;
  const expected = getAdminPasswordHash();
  if (!expected) return false;
  const hash = await sha256Hex(normalized);
  // Constant-time comparison to prevent timing attacks
  const a = new TextEncoder().encode(hash);
  const b = new TextEncoder().encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function createAdminSessionToken(
  now = Date.now(),
): Promise<string> {
  const secret = getAdminSessionSecret();
  if (!secret) {
    throw new Error("ADMIN_AUTH_NOT_CONFIGURED");
  }
  const ttlMs = getAdminSessionTtlMs();
  const payload: AdminSessionPayload = {
    v: 1,
    iat: now,
    exp: now + ttlMs,
  };
  const encodedPayload = serializePayload(payload);
  const signature = await hmacHex(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function verifyAdminSessionToken(
  token: string | null | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (isLocalAdminBypassEnabled()) return true;
  if (!token) return false;

  const [encodedPayload, signature] = token.split(".", 2);
  if (!encodedPayload || !signature) return false;

  const payload = parsePayload(encodedPayload);
  if (!payload || payload.exp <= now) return false;
  const revokedBeforeMs = getAdminSessionRevokedBeforeMs();
  if (revokedBeforeMs > 0 && payload.iat < revokedBeforeMs) return false;
  const secret = getAdminSessionSecret();
  if (!secret) return false;

  const expectedSignature = await hmacHex(
    encodedPayload,
    secret,
  );

  // Constant-time comparison to prevent timing attacks
  const a = new TextEncoder().encode(expectedSignature);
  const b = new TextEncoder().encode(signature);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function getAdminSessionCookieOptions(now = Date.now()) {
  const ttlMs = getAdminSessionTtlMs();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(now + ttlMs),
    maxAge: Math.floor(ttlMs / 1000),
  };
}
