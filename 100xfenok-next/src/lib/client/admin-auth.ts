export const ADMIN_AUTH_STORAGE_KEY = "adminAuth";
export const ADMIN_PASSWORD_HASH =
  "8736ca6f3957409305f60068e93215c85f8751e4dcdc9303832b325a72c7789f";

export type AdminVerifyResult = "matched" | "mismatch" | "unsupported";

export function isAdminAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY) === "true";
}

export function setAdminAuthenticated(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, "true");
}

export function clearAdminAuthenticated(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
}

export async function verifyAdminPassword(input: string): Promise<AdminVerifyResult> {
  const normalized = input.trim();
  if (!normalized) return "mismatch";

  if (!globalThis.crypto?.subtle) {
    return "unsupported";
  }

  const hashBuffer = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return hashHex === ADMIN_PASSWORD_HASH ? "matched" : "mismatch";
}
