// Client-side authentication helpers for Google GIS and session management.
// Ported from Winddown (CONTRACT_winddown-auth) for 100xFenok.

const TOKEN_KEY = "100xfenok.authToken";
const GIS_SRC = "https://accounts.google.com/gsi/client";
export const DEFAULT_CLIENT_ID =
  "435404551214-fv2t9dtg0h1rbcndc225329no5ibrrcu.apps.googleusercontent.com";

let inMemoryToken: string | undefined;

export function loadAuthToken(): string {
  if (inMemoryToken === undefined) {
    inMemoryToken = readStoredToken();
  }
  return inMemoryToken;
}

function readStoredToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(TOKEN_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveAuthToken(token: string): void {
  inMemoryToken = token;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode or storage blocked
  }
}

export function clearAuthToken(): void {
  inMemoryToken = "";
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to do
  }
}

export function getGoogleClientId(): string {
  return (
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ||
    DEFAULT_CLIENT_ID
  );
}

interface GoogleCredentialResponse {
  credential: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
            auto_select?: boolean;
          }): void;
          renderButton(
            parent: HTMLElement,
            options: {
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              width?: number;
              logo_alignment?: "left" | "center";
            },
          ): void;
        };
      };
    };
  }
}

let gisLoading: Promise<boolean> | undefined;

export function loadGoogleScript(): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(false);
  }
  if (window.google?.accounts?.id) return Promise.resolve(true);
  if (gisLoading) return gisLoading;

  gisLoading = new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      gisLoading = undefined;
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return gisLoading;
}

export function renderGoogleButton(
  parent: HTMLElement,
  clientId: string,
  onCredential: (idToken: string) => void,
): boolean {
  const id = window.google?.accounts?.id;
  if (!id || typeof id.renderButton !== "function") return false;
  try {
    id.initialize({
      client_id: clientId,
      callback: (response) => {
        if (response.credential) {
          onCredential(response.credential);
        }
      },
    });
    id.renderButton(parent, {
      theme: "filled_black",
      size: "large",
      text: "continue_with",
      shape: "pill",
      width: 260,
    });
    return true;
  } catch {
    return false;
  }
}

export interface UserProfileClient {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export interface UserMeResponse {
  ok: boolean;
  user?: UserProfileClient;
  settings?: Record<string, unknown>;
  error?: string;
}

export interface AuthExchangeResponse {
  ok: boolean;
  token?: string;
  expiresAt?: number;
  user?: UserProfileClient;
  error?: string;
}

export async function postAuthGoogle(
  idToken: string,
  deviceHint?: string,
): Promise<AuthExchangeResponse> {
  const response = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, deviceHint }),
  });
  const data = (await response.json().catch(() => null)) as AuthExchangeResponse | null;
  if (response.ok && data?.ok && data.token) {
    saveAuthToken(data.token);
  }
  return data ?? { ok: false, error: "Network error" };
}

export async function postAuthLogout(): Promise<{ ok: boolean }> {
  const token = loadAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers,
    });
  } catch {
    // Ignore network error on logout
  }
  clearAuthToken();
  notifyAuthInvalid();
  return { ok: true };
}

export async function fetchMe(): Promise<UserMeResponse> {
  const token = loadAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch("/api/user/me", {
    method: "GET",
    headers,
  });
  if (res.status === 401) {
    clearAuthToken();
    notifyAuthInvalid();
    return { ok: false, error: "Unauthorized" };
  }
  const data = (await res.json().catch(() => null)) as UserMeResponse | null;
  return data ?? { ok: false, error: "Network error" };
}

type AuthInvalidListener = () => void;
const invalidListeners = new Set<AuthInvalidListener>();

export function onAuthInvalid(listener: AuthInvalidListener): () => void {
  invalidListeners.add(listener);
  return () => {
    invalidListeners.delete(listener);
  };
}

export function notifyAuthInvalid(): void {
  invalidListeners.forEach((listener) => listener());
}
