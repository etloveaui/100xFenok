export const ADMIN_SESSION_COOKIE = "fenok_admin_session";
export const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 8;

const DEFAULT_ADMIN_PASSWORD_HASH =
  "8736ca6f3957409305f60068e93215c85f8751e4dcdc9303832b325a72c7789f";
const DEFAULT_ADMIN_SESSION_SECRET =
  `${DEFAULT_ADMIN_PASSWORD_HASH}:fenok-admin-v1`;

type AdminSessionPayload = {
  exp: number;
  v: 1;
};

function getAdminPasswordHash(): string {
  return process.env.NEXT_ADMIN_PASSWORD_HASH || DEFAULT_ADMIN_PASSWORD_HASH;
}

function getAdminSessionSecret(): string {
  return process.env.NEXT_ADMIN_SESSION_SECRET || DEFAULT_ADMIN_SESSION_SECRET;
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
    return {
      v: 1,
      exp: parsed.exp,
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
  const hash = await sha256Hex(normalized);
  return hash === getAdminPasswordHash();
}

export async function createAdminSessionToken(
  now = Date.now(),
): Promise<string> {
  const payload: AdminSessionPayload = {
    v: 1,
    exp: now + ADMIN_SESSION_TTL_MS,
  };
  const encodedPayload = serializePayload(payload);
  const signature = await hmacHex(encodedPayload, getAdminSessionSecret());
  return `${encodedPayload}.${signature}`;
}

export async function verifyAdminSessionToken(
  token: string | null | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false;

  const [encodedPayload, signature] = token.split(".", 2);
  if (!encodedPayload || !signature) return false;

  const payload = parsePayload(encodedPayload);
  if (!payload || payload.exp <= now) return false;

  const expectedSignature = await hmacHex(
    encodedPayload,
    getAdminSessionSecret(),
  );
  return expectedSignature === signature;
}

export function getAdminSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(Date.now() + ADMIN_SESSION_TTL_MS),
  };
}
