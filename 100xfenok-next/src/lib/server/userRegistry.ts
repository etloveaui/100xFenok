// UserRegistry — Durable Object backend and storage for user accounts,
// heartbeat tracking, and admin access control.
// Spec: docs/planning/20260917_closed-site-intro-login-spec.md §4.

import { resolveUserStore } from "./authSession";

export interface UserRegistryEntry {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  firstSeen: string;
  lastSeen: string;
  loginCount: number;
  devices: string[];
  blocked: boolean;
}

export interface UserRegistryStats {
  now: number;
  today: number;
  sevenDays: number;
  total: number;
}

export interface UserRegistryApi {
  upsert(params: {
    sub: string;
    email: string;
    name: string;
    picture?: string;
    device?: string;
    now?: number;
  }): Promise<{ user: UserRegistryEntry; isNew: boolean }>;
  ping(sub: string, now?: number): Promise<boolean>;
  isBlocked(sub: string): Promise<boolean>;
  setBlocked(sub: string, blocked: boolean): Promise<boolean>;
  listUsers(): Promise<UserRegistryEntry[]>;
  getStats(now?: number): Promise<UserRegistryStats>;
  revokeAll(sub: string): Promise<boolean>;
}

export interface IUserRegistryStorage {
  getUser(sub: string): Promise<UserRegistryEntry | null>;
  upsertUser(params: {
    sub: string;
    email: string;
    name: string;
    picture?: string;
    device?: string;
    now: string;
  }): Promise<{ user: UserRegistryEntry; isNew: boolean }>;
  touchUser(sub: string, now: string): Promise<boolean>;
  setBlocked(sub: string, blocked: boolean): Promise<boolean>;
  listUsers(): Promise<UserRegistryEntry[]>;
  getStats(nowMs?: number): Promise<UserRegistryStats>;
}

interface SqlStorageCursorRow {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  first_seen: string;
  last_seen: string;
  login_count: number;
  devices: string;
  blocked: number;
}

interface SqlStorageLike {
  exec(query: string, ...bindings: unknown[]): {
    toArray?(): SqlStorageCursorRow[];
    [Symbol.iterator]?(): Iterator<SqlStorageCursorRow>;
  };
}

function rowToEntry(row: SqlStorageCursorRow): UserRegistryEntry {
  let parsedDevices: string[] = [];
  try {
    parsedDevices = JSON.parse(row.devices);
    if (!Array.isArray(parsedDevices)) parsedDevices = [];
  } catch {
    parsedDevices = [];
  }
  return {
    sub: row.sub,
    email: row.email,
    name: row.name,
    picture: row.picture ?? undefined,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    loginCount: Number(row.login_count) || 1,
    devices: parsedDevices,
    blocked: Boolean(row.blocked),
  };
}

export class UserRegistrySqlStorage implements IUserRegistryStorage {
  private readonly sql: SqlStorageLike;

  constructor(sql: SqlStorageLike) {
    this.sql = sql;
    this.init();
  }

  private init(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        sub TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        picture TEXT,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        login_count INTEGER NOT NULL DEFAULT 1,
        devices TEXT NOT NULL DEFAULT '[]',
        blocked INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  private cursorToArray(cursor: ReturnType<SqlStorageLike["exec"]>): SqlStorageCursorRow[] {
    if (typeof cursor.toArray === "function") {
      return cursor.toArray();
    }
    if (cursor && typeof cursor[Symbol.iterator] === "function") {
      return Array.from(cursor as Iterable<SqlStorageCursorRow>);
    }
    return [];
  }

  async getUser(sub: string): Promise<UserRegistryEntry | null> {
    const cursor = this.sql.exec("SELECT * FROM users WHERE sub = ?", sub);
    const rows = this.cursorToArray(cursor);
    if (rows.length === 0) return null;
    return rowToEntry(rows[0]!);
  }

  async upsertUser(params: {
    sub: string;
    email: string;
    name: string;
    picture?: string;
    device?: string;
    now: string;
  }): Promise<{ user: UserRegistryEntry; isNew: boolean }> {
    const existing = await this.getUser(params.sub);
    if (existing) {
      const devices = [...existing.devices];
      if (params.device && !devices.includes(params.device)) {
        devices.push(params.device);
      }
      const newLoginCount = existing.loginCount + 1;
      const picture = params.picture ?? existing.picture ?? null;
      this.sql.exec(
        `UPDATE users
         SET email = ?, name = ?, picture = ?, last_seen = ?, login_count = ?, devices = ?
         WHERE sub = ?`,
        params.email,
        params.name,
        picture,
        params.now,
        newLoginCount,
        JSON.stringify(devices),
        params.sub,
      );
      const updated: UserRegistryEntry = {
        ...existing,
        email: params.email,
        name: params.name,
        picture: picture ?? undefined,
        lastSeen: params.now,
        loginCount: newLoginCount,
        devices,
      };
      return { user: updated, isNew: false };
    }

    const devices = params.device ? [params.device] : [];
    this.sql.exec(
      `INSERT INTO users (sub, email, name, picture, first_seen, last_seen, login_count, devices, blocked)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0)`,
      params.sub,
      params.email,
      params.name,
      params.picture ?? null,
      params.now,
      params.now,
      JSON.stringify(devices),
    );

    const created: UserRegistryEntry = {
      sub: params.sub,
      email: params.email,
      name: params.name,
      picture: params.picture,
      firstSeen: params.now,
      lastSeen: params.now,
      loginCount: 1,
      devices,
      blocked: false,
    };
    return { user: created, isNew: true };
  }

  async touchUser(sub: string, now: string): Promise<boolean> {
    const cursor = this.sql.exec("SELECT sub FROM users WHERE sub = ?", sub);
    const rows = this.cursorToArray(cursor);
    if (rows.length === 0) return false;
    this.sql.exec("UPDATE users SET last_seen = ? WHERE sub = ?", now, sub);
    return true;
  }

  async setBlocked(sub: string, blocked: boolean): Promise<boolean> {
    this.sql.exec("UPDATE users SET blocked = ? WHERE sub = ?", blocked ? 1 : 0, sub);
    return true;
  }

  async listUsers(): Promise<UserRegistryEntry[]> {
    const cursor = this.sql.exec("SELECT * FROM users ORDER BY last_seen DESC");
    const rows = this.cursorToArray(cursor);
    return rows.map(rowToEntry);
  }

  async getStats(nowMs = Date.now()): Promise<UserRegistryStats> {
    const users = await this.listUsers();
    return computeStatsFromList(users, nowMs);
  }
}

export class UserRegistryMemoryStorage implements IUserRegistryStorage {
  private readonly users = new Map<string, UserRegistryEntry>();

  async getUser(sub: string): Promise<UserRegistryEntry | null> {
    return this.users.get(sub) ?? null;
  }

  async upsertUser(params: {
    sub: string;
    email: string;
    name: string;
    picture?: string;
    device?: string;
    now: string;
  }): Promise<{ user: UserRegistryEntry; isNew: boolean }> {
    const existing = this.users.get(params.sub);
    if (existing) {
      const devices = [...existing.devices];
      if (params.device && !devices.includes(params.device)) {
        devices.push(params.device);
      }
      const updated: UserRegistryEntry = {
        ...existing,
        email: params.email,
        name: params.name,
        picture: params.picture ?? existing.picture,
        lastSeen: params.now,
        loginCount: existing.loginCount + 1,
        devices,
      };
      this.users.set(params.sub, updated);
      return { user: updated, isNew: false };
    }

    const created: UserRegistryEntry = {
      sub: params.sub,
      email: params.email,
      name: params.name,
      picture: params.picture,
      firstSeen: params.now,
      lastSeen: params.now,
      loginCount: 1,
      devices: params.device ? [params.device] : [],
      blocked: false,
    };
    this.users.set(params.sub, created);
    return { user: created, isNew: true };
  }

  async touchUser(sub: string, now: string): Promise<boolean> {
    const existing = this.users.get(sub);
    if (!existing) return false;
    existing.lastSeen = now;
    return true;
  }

  async setBlocked(sub: string, blocked: boolean): Promise<boolean> {
    const existing = this.users.get(sub);
    if (existing) {
      existing.blocked = blocked;
    }
    return true;
  }

  async listUsers(): Promise<UserRegistryEntry[]> {
    return Array.from(this.users.values()).sort((a, b) =>
      b.lastSeen.localeCompare(a.lastSeen),
    );
  }

  async getStats(nowMs = Date.now()): Promise<UserRegistryStats> {
    return computeStatsFromList(Array.from(this.users.values()), nowMs);
  }
}

function computeStatsFromList(
  users: UserRegistryEntry[],
  nowMs: number,
): UserRegistryStats {
  const fiveMinutesAgo = nowMs - 5 * 60 * 1000;
  const sevenDaysAgo = nowMs - 7 * 24 * 60 * 60 * 1000;

  // Start of today in KST (UTC+9)
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(nowMs + kstOffsetMs);
  const kstYear = kstNow.getUTCFullYear();
  const kstMonth = kstNow.getUTCMonth();
  const kstDate = kstNow.getUTCDate();
  const startOfKstTodayMs = Date.UTC(kstYear, kstMonth, kstDate) - kstOffsetMs;

  let nowCount = 0;
  let todayCount = 0;
  let sevenDaysCount = 0;

  for (const u of users) {
    const t = new Date(u.lastSeen).getTime();
    if (t >= fiveMinutesAgo) nowCount += 1;
    if (t >= startOfKstTodayMs) todayCount += 1;
    if (t >= sevenDaysAgo) sevenDaysCount += 1;
  }

  return {
    now: nowCount,
    today: todayCount,
    sevenDays: sevenDaysCount,
    total: users.length,
  };
}

export class UserRegistryCore implements UserRegistryApi {
  constructor(
    private readonly storage: IUserRegistryStorage,
    private readonly env?: unknown,
  ) {}

  async upsert(params: {
    sub: string;
    email: string;
    name: string;
    picture?: string;
    device?: string;
    now?: number;
  }): Promise<{ user: UserRegistryEntry; isNew: boolean }> {
    const nowIso = new Date(params.now ?? Date.now()).toISOString();
    return this.storage.upsertUser({
      ...params,
      now: nowIso,
    });
  }

  async ping(sub: string, now?: number): Promise<boolean> {
    const nowIso = new Date(now ?? Date.now()).toISOString();
    return this.storage.touchUser(sub, nowIso);
  }

  async isBlocked(sub: string): Promise<boolean> {
    const user = await this.storage.getUser(sub);
    return user?.blocked ?? false;
  }

  async setBlocked(sub: string, blocked: boolean): Promise<boolean> {
    return this.storage.setBlocked(sub, blocked);
  }

  async listUsers(): Promise<UserRegistryEntry[]> {
    return this.storage.listUsers();
  }

  async getStats(now?: number): Promise<UserRegistryStats> {
    return this.storage.getStats(now);
  }

  async revokeAll(sub: string): Promise<boolean> {
    try {
      const store = await resolveUserStore(sub, this.env);
      await store.revokeAll();
      return true;
    } catch {
      return false;
    }
  }
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): unknown;
}

let inMemoryRegistry: UserRegistryCore | null = null;

export function getInMemoryUserRegistry(): UserRegistryCore {
  if (!inMemoryRegistry) {
    inMemoryRegistry = new UserRegistryCore(new UserRegistryMemoryStorage());
  }
  return inMemoryRegistry;
}

export function resetInMemoryUserRegistry(): void {
  inMemoryRegistry = null;
}

export async function resolveUserRegistry(
  explicitEnv?: unknown,
): Promise<UserRegistryApi> {
  let env = explicitEnv;
  if (!env) {
    try {
      const mod = await import("@opennextjs/cloudflare");
      const ctx = await mod.getCloudflareContext({ async: true });
      env = ctx.env;
    } catch {
      // Node.js or unit test environment
    }
  }

  const registryNamespace = (env as Record<string, unknown> | undefined)?.USER_REGISTRY as
    | DurableObjectNamespaceLike
    | undefined;

  if (
    registryNamespace &&
    typeof registryNamespace.idFromName === "function" &&
    typeof registryNamespace.get === "function"
  ) {
    const id = registryNamespace.idFromName("global");
    return registryNamespace.get(id) as UserRegistryApi;
  }

  return getInMemoryUserRegistry();
}

/**
 * First-login Telegram notice.
 * Spec §4: if runtime-callable Telegram path exists, sends one line.
 * If only workflow-side paths exist, fails soft (reported as [blocked]).
 */
export async function sendFirstLoginNotice(
  user: { name: string; email: string },
  env?: unknown,
): Promise<boolean> {
  const token =
    (env as Record<string, string> | undefined)?.TELEGRAM_BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN;
  const chatId =
    (env as Record<string, string> | undefined)?.TELEGRAM_CHAT_ID ||
    process.env.TELEGRAM_CHAT_ID;

  if (token && chatId) {
    try {
      const text = `새 사용자: ${user.name} <${user.email}>`;
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  return false;
}
