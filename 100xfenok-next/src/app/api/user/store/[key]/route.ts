import { NextResponse } from "next/server";
import { resolveCurrentSession } from "@/lib/server/authSession";
import { resolveUserRegistry } from "@/lib/server/userRegistry";

export const dynamic = "force-dynamic";
export const revalidate = false;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export const ALLOWED_STORE_KEYS = ["portfolio", "watchlist", "ib", "macro-presets"] as const;
export type AllowedStoreKey = (typeof ALLOWED_STORE_KEYS)[number] | `ib:${string}`;

export function isAllowedStoreKey(key: string): key is AllowedStoreKey {
  if ((ALLOWED_STORE_KEYS as readonly string[]).includes(key)) {
    return true;
  }
  return key.startsWith("ib:") && /^ib:[A-Za-z0-9._-]+$/.test(key);
}

export const MAX_STORE_SIZE_BYTES = 256 * 1024; // 256 KB

interface RouteContext {
  params: Promise<{ key: string }> | { key: string };
}

async function resolveKey(context: RouteContext): Promise<string> {
  const resolved = await context.params;
  return resolved.key;
}

export async function GET(request: Request, context: RouteContext) {
  const key = await resolveKey(context);
  if (!isAllowedStoreKey(key)) {
    return NextResponse.json(
      { ok: false, error: `Invalid store key: ${key}. Allowed keys: ${ALLOWED_STORE_KEYS.join(", ")}, ib:<profileId>` },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const session = await resolveCurrentSession(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const registry = await resolveUserRegistry();
  if (await registry.isBlocked(session.sub)) {
    return NextResponse.json(
      { ok: false, error: "Forbidden: Account is blocked" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const stored = await session.store.getStoreData(key);
  return NextResponse.json(
    {
      ok: true,
      key,
      value: stored ? stored.value : null,
      updatedAt: stored ? stored.updatedAt : 0,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export async function PUT(request: Request, context: RouteContext) {
  const key = await resolveKey(context);
  if (!isAllowedStoreKey(key)) {
    return NextResponse.json(
      { ok: false, error: `Invalid store key: ${key}. Allowed keys: ${ALLOWED_STORE_KEYS.join(", ")}, ib:<profileId>` },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const session = await resolveCurrentSession(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const registry = await resolveUserRegistry();
  if (await registry.isBlocked(session.sub)) {
    return NextResponse.json(
      { ok: false, error: "Forbidden: Account is blocked" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const rawBody = await request.text();
  const byteLength = new TextEncoder().encode(rawBody).byteLength;
  if (byteLength > MAX_STORE_SIZE_BYTES) {
    return NextResponse.json(
      { ok: false, error: `Payload too large (${byteLength} bytes exceeds 256 KB limit)` },
      { status: 413, headers: NO_STORE_HEADERS },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const value =
    parsed && typeof parsed === "object" && "value" in parsed
      ? (parsed as { value: unknown }).value
      : parsed;

  const incomingUpdatedAt =
    parsed &&
    typeof parsed === "object" &&
    "updatedAt" in parsed &&
    typeof (parsed as { updatedAt: unknown }).updatedAt === "number"
      ? (parsed as { updatedAt: number }).updatedAt
      : undefined;

  const saved = await session.store.setStoreData(key, value, incomingUpdatedAt);

  return NextResponse.json(
    {
      ok: true,
      key,
      value: saved.value,
      updatedAt: saved.updatedAt,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
