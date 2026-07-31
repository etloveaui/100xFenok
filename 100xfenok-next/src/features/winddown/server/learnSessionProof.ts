import {
  signAdminScopedServerValue,
  verifyAdminScopedServerValue,
} from "@/lib/server/admin-session";

const PROOF_SCOPE = "winddown-learn-session-v1";
const MAX_PROOF_LENGTH = 2_048;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const KST_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const WIND_DOWN_LEARN_SESSION_TTL_MS = 18 * 60 * 60 * 1000;

export type WindDownLearnSessionManifest = {
  schemaVersion: 1;
  sessionId: string;
  habitKstDay: string;
  seed: string;
  cardIds: string[];
  contentDigest: string;
  issuedAtIso: string;
  expiresAtIso: string;
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeManifest(manifest: WindDownLearnSessionManifest) {
  return bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(manifest)),
  );
}

function parseIso(value: unknown) {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

export function normalizeWindDownLearnSessionManifest(
  value: unknown,
): WindDownLearnSessionManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const expected = new Set([
    "schemaVersion",
    "sessionId",
    "habitKstDay",
    "seed",
    "cardIds",
    "contentDigest",
    "issuedAtIso",
    "expiresAtIso",
  ]);
  if (
    Object.keys(source).length !== expected.size
    || !Object.keys(source).every((key) => expected.has(key))
  ) return null;
  const issuedAtIso = parseIso(source.issuedAtIso);
  const expiresAtIso = parseIso(source.expiresAtIso);
  const cardIds = Array.isArray(source.cardIds)
    ? source.cardIds.filter((id): id is string => typeof id === "string")
    : [];
  if (
    source.schemaVersion !== 1
    || typeof source.sessionId !== "string"
    || !SAFE_ID.test(source.sessionId)
    || typeof source.habitKstDay !== "string"
    || !KST_DAY.test(source.habitKstDay)
    || typeof source.seed !== "string"
    || !SAFE_ID.test(source.seed)
    || cardIds.length !== 5
    || new Set(cardIds).size !== cardIds.length
    || cardIds.some((id) => id.length > 120 || !SAFE_ID.test(id))
    || typeof source.contentDigest !== "string"
    || !SHA256_HEX.test(source.contentDigest)
    || !issuedAtIso
    || !expiresAtIso
    || Date.parse(expiresAtIso) <= Date.parse(issuedAtIso)
  ) return null;
  return {
    schemaVersion: 1,
    sessionId: source.sessionId,
    habitKstDay: source.habitKstDay,
    seed: source.seed,
    cardIds,
    contentDigest: source.contentDigest,
    issuedAtIso,
    expiresAtIso,
  };
}

export function isWindDownLearnSessionProof(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length < 80
    || value.length > MAX_PROOF_LENGTH
  ) return false;
  const parts = value.split(".");
  return parts.length === 2
    && /^[A-Za-z0-9_-]+$/.test(parts[0] ?? "")
    && /^[a-f0-9]{64}$/.test(parts[1] ?? "");
}

export async function createWindDownLearnSessionProof(
  manifestInput: WindDownLearnSessionManifest,
) {
  const manifest = normalizeWindDownLearnSessionManifest(manifestInput);
  if (!manifest) throw new Error("WINDDOWN_LEARN_SESSION_MANIFEST_INVALID");
  const encoded = encodeManifest(manifest);
  const signature = await signAdminScopedServerValue(PROOF_SCOPE, encoded);
  return `${encoded}.${signature}`;
}

export async function verifyWindDownLearnSessionProof(args: {
  proof: unknown;
  now?: Date;
}) {
  if (!isWindDownLearnSessionProof(args.proof)) return null;
  const [encoded, signature] = args.proof.split(".", 2);
  if (!await verifyAdminScopedServerValue(PROOF_SCOPE, encoded, signature)) {
    return null;
  }
  try {
    const decoded = new TextDecoder().decode(base64UrlToBytes(encoded));
    const manifest = normalizeWindDownLearnSessionManifest(JSON.parse(decoded));
    const now = args.now ?? new Date();
    if (
      !manifest
      || !Number.isFinite(now.getTime())
      || Date.parse(manifest.issuedAtIso) > now.getTime() + 30_000
      || Date.parse(manifest.expiresAtIso) <= now.getTime()
    ) return null;
    return manifest;
  } catch {
    return null;
  }
}
