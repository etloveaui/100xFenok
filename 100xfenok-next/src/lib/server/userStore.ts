// UserStore — Durable Object backend for Google user profiles and 30-day session tokens.
// Spec: docs/planning/20260917_closed-site-intro-login-spec.md §3. Ported from Winddown.

export interface UserProfile {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredToken {
  hash: string;
  createdAt: number;
  expiresAt: number;
  deviceHint?: string;
}

export interface UserSettings {
  theme?: string;
  [key: string]: unknown;
}

export interface UserStoreApi {
  getProfile(): Promise<UserProfile | null>;
  saveProfile(profile: Omit<UserProfile, "createdAt" | "updatedAt">): Promise<UserProfile>;
  mintToken(deviceHint?: string, now?: number): Promise<{ token: string; expiresAt: number }>;
  verifyToken(secret: string, now?: number): Promise<boolean>;
  revokeToken(secret: string): Promise<boolean>;
  revokeAll(): Promise<void>;
  listTokens(): Promise<StoredToken[]>;
  getSettings(): Promise<UserSettings>;
  updateSettings(settings: Partial<UserSettings>): Promise<UserSettings>;
}

export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const TOKEN_REFRESH_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000; // 15 days

export const PROFILE_KEY = "userProfile";
export const TOKENS_KEY = "userTokens";
export const SETTINGS_KEY = "userSettings";

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateSecret(bytes = 32): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete?(key: string): Promise<boolean>;
}

export class UserStoreCore implements UserStoreApi {
  protected storage: DurableObjectStorageLike;

  constructor(state: { storage: DurableObjectStorageLike }, _env?: unknown) {
    this.storage = state.storage;
  }

  async getProfile(): Promise<UserProfile | null> {
    return (await this.storage.get<UserProfile>(PROFILE_KEY)) ?? null;
  }

  async saveProfile(input: Omit<UserProfile, "createdAt" | "updatedAt">): Promise<UserProfile> {
    const existing = await this.getProfile();
    const now = Date.now();
    const profile: UserProfile = {
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.storage.put(PROFILE_KEY, profile);
    return profile;
  }

  async mintToken(deviceHint?: string, now?: number): Promise<{ token: string; expiresAt: number }> {
    const profile = await this.getProfile();
    const sub = profile?.sub ?? "anonymous";
    const current = now ?? Date.now();
    const secret = generateSecret();
    const hash = await sha256Hex(secret);
    const expiresAt = current + TOKEN_TTL_MS;

    const storedTokens = (await this.storage.get<StoredToken[]>(TOKENS_KEY)) ?? [];
    const valid = storedTokens.filter((t) => t.expiresAt > current);
    valid.push({ hash, createdAt: current, expiresAt, deviceHint });
    await this.storage.put(TOKENS_KEY, valid);

    const token = `${sub}.${secret}`;
    return { token, expiresAt };
  }

  async verifyToken(secret: string, now?: number): Promise<boolean> {
    const current = now ?? Date.now();
    const hash = await sha256Hex(secret);
    const storedTokens = (await this.storage.get<StoredToken[]>(TOKENS_KEY)) ?? [];
    const match = storedTokens.find((t) => t.hash === hash);

    if (!match || match.expiresAt <= current) {
      return false;
    }

    // Sliding refresh if remaining TTL is less than 15 days
    if (match.expiresAt - current < TOKEN_REFRESH_THRESHOLD_MS) {
      match.expiresAt = current + TOKEN_TTL_MS;
      await this.storage.put(TOKENS_KEY, storedTokens);
    }

    return true;
  }

  async revokeToken(secret: string): Promise<boolean> {
    const hash = await sha256Hex(secret);
    const storedTokens = (await this.storage.get<StoredToken[]>(TOKENS_KEY)) ?? [];
    const remaining = storedTokens.filter((t) => t.hash !== hash);
    const removed = remaining.length < storedTokens.length;
    if (removed) {
      await this.storage.put(TOKENS_KEY, remaining);
    }
    return removed;
  }

  async revokeAll(): Promise<void> {
    await this.storage.put(TOKENS_KEY, []);
  }

  async listTokens(): Promise<StoredToken[]> {
    return (await this.storage.get<StoredToken[]>(TOKENS_KEY)) ?? [];
  }

  async getSettings(): Promise<UserSettings> {
    return (await this.storage.get<UserSettings>(SETTINGS_KEY)) ?? {};
  }

  async updateSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
    const existing = await this.getSettings();
    const merged = { ...existing, ...settings };
    await this.storage.put(SETTINGS_KEY, merged);
    return merged;
  }
}

export function createInMemoryStorage(): DurableObjectStorageLike {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined;
    },
    async put(key: string, value: unknown): Promise<void> {
      map.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return map.delete(key);
    },
  };
}

const inMemoryStores = new Map<string, UserStoreCore>();

export function getInMemoryUserStore(sub: string): UserStoreCore {
  let store = inMemoryStores.get(sub);
  if (!store) {
    store = new UserStoreCore({ storage: createInMemoryStorage() });
    inMemoryStores.set(sub, store);
  }
  return store;
}

export function resetInMemoryUserStores(): void {
  inMemoryStores.clear();
}

