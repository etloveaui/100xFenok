import { createHash } from "node:crypto";
import policyRegistry from "../../generated/data-supply-policy-registry.json";
import {
  getDataSupplyEtfEnrollmentDocument,
  getDataSupplyEtfIndexDocument,
  getDataSupplyEtfPayloadDocument,
  getStockanalysisAssetDocument,
  type PublicJsonDocument,
} from "./data-loader";

export type { PublicJsonDocument } from "./data-loader";

type JsonRecord = Record<string, unknown>;
type ResolutionState = "fresh_primary" | "fresh_fallback" | "lkg_primary" | "lkg_fallback" | "unavailable";
type ProviderRole = "primary" | "fallback" | null;

export interface DataSupplyProviderPolicy {
  name: string;
  endpoint_family: string;
  schema: string;
}

export interface DataSupplyDomainPolicy {
  resolution_scope: "domain_atomic";
  providers: readonly [DataSupplyProviderPolicy, DataSupplyProviderPolicy];
  fresh_ttl_hours: number;
  emergency_lkg_ttl_days: number;
  recovery_green_required: number;
  allowed_consumers: readonly string[];
  policy_digest: string;
}

export interface EtfDataSupplyMetadata {
  enrollment_state: "enrolled";
  resolution_state: ResolutionState;
  provider_role: ProviderRole;
  fallback_depth: number | null;
  source_as_of: string | null;
  selected_at: string | null;
  source_age_days: number | null;
  reason_code: string | null;
  recovery_transition: "unavailable" | null;
  projection_digest: string;
}

export type EtfDetailResolution =
  | { kind: "selected"; payload: JsonRecord; dataSupply: EtfDataSupplyMetadata; projectionDigest: string }
  | {
      kind: "unavailable";
      dataSupply: EtfDataSupplyMetadata;
      projectionDigest: string;
      stateObservedAt: string;
    }
  | { kind: "direct"; payload: JsonRecord; projectionDigest: string }
  | { kind: "not_found"; projectionDigest: string }
  | {
      kind: "error";
      code: "DATA_SUPPLY_GUARD_UNAVAILABLE" | "DATA_SUPPLY_INDEX_UNAVAILABLE";
      projectionDigest: string | null;
    };

export interface EtfDetailResolverDependencies {
  readEnrollment: () => Promise<PublicJsonDocument | null>;
  readIndex: () => Promise<PublicJsonDocument | null>;
  readProjectionPayload: (ticker: string) => Promise<PublicJsonDocument | null>;
  readDirectPayload: (ticker: string) => Promise<PublicJsonDocument | null>;
  now: () => Date;
}

const DEFAULT_DEPENDENCIES: EtfDetailResolverDependencies = {
  readEnrollment: getDataSupplyEtfEnrollmentDocument,
  readIndex: getDataSupplyEtfIndexDocument,
  readProjectionPayload: getDataSupplyEtfPayloadDocument,
  readDirectPayload: (ticker) => getStockanalysisAssetDocument("etfs", ticker),
  now: () => new Date(),
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as JsonRecord;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function policyRegistryFailure(message: string): never {
  throw new Error(`data-supply-policy-registry: ${message}`);
}

export function validateDataSupplyPolicyRegistryForConsumer(
  value: unknown,
  domain: string,
  consumerId: string,
): DataSupplyDomainPolicy {
  const registry = asRecord(value);
  const domains = asRecord(registry?.domains);
  const policy = asRecord(domains?.[domain]);
  const providers = Array.isArray(policy?.providers)
    ? policy.providers.map(asRecord)
    : [];
  const consumers = Array.isArray(policy?.allowed_consumers)
    ? policy.allowed_consumers
    : [];
  if (
    registry?.schema_version !== "data-supply-policy-registry/v1"
    || !isSha256(registry.policy_digest)
    || !domains
    || Object.keys(domains).sort().join(",") !== "etf_detail,stock_detail"
    || !policy
    || policy.resolution_scope !== "domain_atomic"
    || providers.length !== 2
    || !providers[0]
    || !providers[1]
    || providers[0].name !== "stockanalysis"
    || providers[1].name !== "yahoo_finance"
    || typeof providers[0].endpoint_family !== "string"
    || typeof providers[1].endpoint_family !== "string"
    || typeof providers[0].schema !== "string"
    || typeof providers[1].schema !== "string"
    || !Number.isInteger(policy.fresh_ttl_hours)
    || (policy.fresh_ttl_hours as number) <= 0
    || !Number.isInteger(policy.emergency_lkg_ttl_days)
    || (policy.emergency_lkg_ttl_days as number) <= 0
    || !Number.isInteger(policy.recovery_green_required)
    || (policy.recovery_green_required as number) <= 0
    || consumers.length === 0
    || consumers.some((consumer) => typeof consumer !== "string")
  ) policyRegistryFailure(`domain ${domain} contract is invalid`);
  const calculated = createHash("sha256").update(stableJson({
    schema_version: registry.schema_version,
    domains,
  })).digest("hex");
  if (calculated !== registry.policy_digest) policyRegistryFailure("policy digest mismatch");
  if (!consumers.includes(consumerId)) {
    policyRegistryFailure(`consumer ${consumerId} is not authorized for domain ${domain}`);
  }
  const first = providers[0] as JsonRecord;
  const second = providers[1] as JsonRecord;
  return Object.freeze({
    resolution_scope: "domain_atomic" as const,
    providers: Object.freeze([
      Object.freeze({
        name: first.name as string,
        endpoint_family: first.endpoint_family as string,
        schema: first.schema as string,
      }),
      Object.freeze({
        name: second.name as string,
        endpoint_family: second.endpoint_family as string,
        schema: second.schema as string,
      }),
    ]) as readonly [DataSupplyProviderPolicy, DataSupplyProviderPolicy],
    fresh_ttl_hours: policy.fresh_ttl_hours as number,
    emergency_lkg_ttl_days: policy.emergency_lkg_ttl_days as number,
    recovery_green_required: policy.recovery_green_required as number,
    allowed_consumers: Object.freeze([...(consumers as string[])]),
    policy_digest: registry.policy_digest as string,
  });
}

export const DATA_SUPPLY_ETF_DETAIL_POLICY = validateDataSupplyPolicyRegistryForConsumer(
  policyRegistry,
  "etf_detail",
  "100xfenok-next.data_supply_etf_detail",
);

export async function sha256Text(value: string): Promise<string> {
  return createHash("sha256").update(value).digest("hex");
}

export async function canonicalJsonSha256(value: unknown): Promise<string> {
  return sha256Text(stableJson(value));
}

async function canonicalIndexSha256(value: JsonRecord): Promise<string> {
  const withoutDigest = { ...value };
  delete withoutDigest.index_sha256;
  return canonicalJsonSha256(withoutDigest);
}

function parseGuard(value: JsonRecord) {
  const tickers = Array.isArray(value.tickers) && value.tickers.every((ticker) => typeof ticker === "string")
    ? value.tickers as string[]
    : null;
  if (
    value.schema_version !== "data-supply-etf-detail-enrollment/v1"
    || value.domain !== "etf_detail"
    || !isIsoTimestamp(value.generated_at)
    || typeof value.active_transaction_id !== "string"
    || !isSha256(value.active_generation_manifest_sha256)
    || !isSha256(value.index_sha256)
    || !isSha256(value.membership_sha256)
    || !Number.isInteger(value.enrolled_count)
    || !tickers
    || value.enrolled_count !== tickers.length
    || new Set(tickers).size !== tickers.length
    || tickers.some((ticker, index) => index > 0 && ticker <= tickers[index - 1]!)
  ) return null;
  return {
    transactionId: value.active_transaction_id,
    manifestSha: value.active_generation_manifest_sha256,
    indexSha: value.index_sha256,
    membershipSha: value.membership_sha256,
    tickers: new Set(tickers),
  } as const;
}

async function parseIndex(
  document: PublicJsonDocument,
  guard: NonNullable<ReturnType<typeof parseGuard>>,
  now: Date,
) {
  const value = document.value;
  if (
    value.active_transaction_id !== guard.transactionId
    || value.active_generation_manifest_sha256 !== guard.manifestSha
    || value.membership_sha256 !== guard.membershipSha
    || value.index_sha256 !== guard.indexSha
    || await canonicalIndexSha256(value) !== guard.indexSha
  ) return { kind: "crossbind" } as const;
  const entries = asRecord(value.entries);
  const enrolledCount = typeof value.enrolled_count === "number" && Number.isInteger(value.enrolled_count) ? value.enrolled_count : null;
  const selectedCount = typeof value.selected_count === "number" && Number.isInteger(value.selected_count) ? value.selected_count : null;
  const unavailableCount = typeof value.unavailable_count === "number" && Number.isInteger(value.unavailable_count) ? value.unavailable_count : null;
  if (
    value.schema_version !== "data-supply-etf-detail-public-index/v1"
    || value.domain !== "etf_detail"
    || !isIsoTimestamp(value.generated_at)
    || !entries
    || enrolledCount === null
    || selectedCount === null
    || unavailableCount === null
    || enrolledCount !== guard.tickers.size
    || Object.keys(entries).length !== guard.tickers.size
    || selectedCount + unavailableCount !== enrolledCount
    || Object.keys(entries).some((ticker) => !guard.tickers.has(ticker))
  ) return { kind: "invalid" } as const;
  let selectedEntries = 0;
  let unavailableEntries = 0;
  for (const ticker of guard.tickers) {
    const parsed = parseEntry(ticker, entries[ticker], guard.indexSha, now);
    if (!parsed) return { kind: "invalid" } as const;
    if (parsed.metadata.resolution_state === "unavailable") unavailableEntries += 1;
    else selectedEntries += 1;
  }
  if (selectedEntries !== selectedCount || unavailableEntries !== unavailableCount) return { kind: "invalid" } as const;
  return { kind: "ok", entries, generatedAt: value.generated_at as string } as const;
}

function expectedRole(state: ResolutionState): ProviderRole {
  if (state.endsWith("primary")) return "primary";
  if (state.endsWith("fallback")) return "fallback";
  return null;
}

function sourceAgeDays(sourceAsOf: string | null, now: Date): number | null {
  if (!sourceAsOf) return null;
  const sourceTime = Date.parse(sourceAsOf);
  if (!Number.isFinite(sourceTime) || !Number.isFinite(now.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - sourceTime) / 86_400_000));
}

function parseEntry(ticker: string, value: unknown, digest: string, now: Date) {
  const entry = asRecord(value);
  if (!entry || entry.ticker !== ticker || entry.enrollment_state !== "enrolled") return null;
  const state = entry.resolution_state;
  if (
    state !== "fresh_primary"
    && state !== "fresh_fallback"
    && state !== "lkg_primary"
    && state !== "lkg_fallback"
    && state !== "unavailable"
  ) return null;
  const resolutionState = state as ResolutionState;
  if (resolutionState === "unavailable") {
    if (
      entry.provider_role !== null
      || entry.fallback_depth !== null
      || entry.source_as_of !== null
      || (entry.selected_at !== null && entry.selected_at !== undefined)
      || entry.payload_sha256 !== null
      || entry.payload_path !== null
      || entry.recovery_transition !== "unavailable"
    ) return null;
  } else if (
    entry.provider_role !== expectedRole(resolutionState)
    || !Number.isInteger(entry.fallback_depth)
    || (entry.fallback_depth as number) < 0
    || (entry.provider_role === "primary" && entry.fallback_depth !== 0)
    || (entry.provider_role === "fallback" && (entry.fallback_depth as number) < 1)
    || !isIsoTimestamp(entry.source_as_of)
    || !isIsoTimestamp(entry.selected_at)
    || !isSha256(entry.payload_sha256)
    || entry.payload_path !== `payloads/${ticker}.json`
    || typeof entry.reason_code !== "string"
    || !entry.reason_code
  ) return null;

  const sourceAsOf = resolutionState === "unavailable" ? null : entry.source_as_of as string;
  return {
    entry,
    metadata: {
      enrollment_state: "enrolled",
      resolution_state: resolutionState,
      provider_role: expectedRole(resolutionState),
      fallback_depth: resolutionState === "unavailable" ? null : entry.fallback_depth as number,
      source_as_of: sourceAsOf,
      selected_at: resolutionState === "unavailable" ? null : entry.selected_at as string,
      source_age_days: sourceAgeDays(sourceAsOf, now),
      reason_code: resolutionState === "unavailable" ? null : entry.reason_code as string,
      recovery_transition: resolutionState === "unavailable" ? "unavailable" : null,
      projection_digest: digest,
    } satisfies EtfDataSupplyMetadata,
  };
}

function isStrictDirectEtfPayload(payload: JsonRecord, ticker: string): boolean {
  const primary = DATA_SUPPLY_ETF_DETAIL_POLICY.providers[0];
  if (
    payload.schema_version !== primary.schema
    || (payload.source !== primary.name && payload.source_provider !== primary.name)
    || payload.asset_type !== "etf"
    || payload.ticker !== ticker
    || "data_supply" in payload
    || payload.detail_status === "yf_fallback"
  ) return false;
  const text = stableJson(payload).toLowerCase();
  return !text.includes("yahoo") && !text.includes("yf_fallback");
}

export function mergeEtfDataSupply(payload: JsonRecord, dataSupply: EtfDataSupplyMetadata): JsonRecord {
  if ("data_supply" in payload) throw new Error("DATA_SUPPLY_SCHEMA_COLLISION");
  return { ...payload, data_supply: dataSupply };
}

export function buildUnavailableEtfRepresentation(
  ticker: string,
  dataSupply: EtfDataSupplyMetadata,
  independentSummary: JsonRecord | null,
) {
  if (independentSummary) {
    return {
      kind: "summary",
      body: mergeEtfDataSupply(independentSummary, dataSupply),
    } as const;
  }
  return {
    kind: "typed_unavailable",
    body: {
      error: "DATA_SUPPLY_UNAVAILABLE",
      ticker,
      data_supply: dataSupply,
    },
  } as const;
}

export async function resolveDataSupplyEtfDetail(
  ticker: string,
  overrides: Partial<EtfDetailResolverDependencies> = {},
): Promise<EtfDetailResolution> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const guardDocument = await dependencies.readEnrollment();
  const guard = guardDocument ? parseGuard(guardDocument.value) : null;
  if (!guard) return { kind: "error", code: "DATA_SUPPLY_GUARD_UNAVAILABLE", projectionDigest: null };
  if (await canonicalJsonSha256([...guard.tickers]) !== guard.membershipSha) {
    return { kind: "error", code: "DATA_SUPPLY_GUARD_UNAVAILABLE", projectionDigest: null };
  }

  const enrolled = guard.tickers.has(ticker);
  const resolveDirect = async (): Promise<EtfDetailResolution> => {
    const direct = await dependencies.readDirectPayload(ticker);
    if (!direct) return { kind: "not_found", projectionDigest: guard.indexSha };
    return isStrictDirectEtfPayload(direct.value, ticker)
      ? { kind: "direct", payload: direct.value, projectionDigest: guard.indexSha }
      : { kind: "error", code: "DATA_SUPPLY_INDEX_UNAVAILABLE", projectionDigest: guard.indexSha };
  };
  const indexDocument = await dependencies.readIndex();
  if (!indexDocument) {
    if (enrolled) return { kind: "error", code: "DATA_SUPPLY_INDEX_UNAVAILABLE", projectionDigest: guard.indexSha };
    return resolveDirect();
  }

  const parsedIndex = await parseIndex(indexDocument, guard, dependencies.now());
  if (parsedIndex.kind === "crossbind") {
    return { kind: "error", code: "DATA_SUPPLY_GUARD_UNAVAILABLE", projectionDigest: guard.indexSha };
  }
  if (parsedIndex.kind === "invalid") {
    if (enrolled) return { kind: "error", code: "DATA_SUPPLY_INDEX_UNAVAILABLE", projectionDigest: guard.indexSha };
    return resolveDirect();
  }
  const entries = parsedIndex.entries;
  if (!enrolled) {
    return resolveDirect();
  }

  const parsed = parseEntry(ticker, entries[ticker], guard.indexSha, dependencies.now());
  if (!parsed) return { kind: "error", code: "DATA_SUPPLY_INDEX_UNAVAILABLE", projectionDigest: guard.indexSha };
  if (parsed.metadata.resolution_state === "unavailable") {
    return {
      kind: "unavailable",
      dataSupply: parsed.metadata,
      projectionDigest: guard.indexSha,
      stateObservedAt: parsedIndex.generatedAt,
    };
  }

  const payloadDocument = await dependencies.readProjectionPayload(ticker);
  if (
    !payloadDocument
    || await sha256Text(payloadDocument.raw) !== parsed.entry.payload_sha256
    || payloadDocument.value.ticker !== ticker
    || payloadDocument.value.asset_type !== "etf"
    || payloadDocument.value.schema_version !== DATA_SUPPLY_ETF_DETAIL_POLICY.providers[1].schema
    || payloadDocument.value.source_as_of !== parsed.metadata.source_as_of
    || "data_supply" in payloadDocument.value
  ) return { kind: "error", code: "DATA_SUPPLY_INDEX_UNAVAILABLE", projectionDigest: guard.indexSha };

  return {
    kind: "selected",
    payload: payloadDocument.value,
    dataSupply: parsed.metadata,
    projectionDigest: guard.indexSha,
  };
}
