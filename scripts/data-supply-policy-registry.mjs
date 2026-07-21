#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_SUPPLY_POLICY_REGISTRY_SCHEMA = "data-supply-policy-registry/v1";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DATA_SUPPLY_POLICY_REGISTRY_PATH = path.resolve(
  process.env.DATA_SUPPLY_POLICY_REGISTRY_PATH
    || path.join(SCRIPT_DIR, "data_supply_policy_registry.v1.json"),
);

const ENROLLED_DOMAINS = Object.freeze(["etf_detail", "stock_detail"]);
const KNOWN_PROVIDERS = new Set(["stockanalysis", "yahoo_finance"]);
const EXPECTED_PROVIDER_ORDER = Object.freeze(["stockanalysis", "yahoo_finance"]);
const HEX64_RE = /^[0-9a-f]{64}$/;
const IDENTIFIER_RE = /^[A-Za-z0-9._-]+$/;
const DOMAIN_KEYS = Object.freeze([
  "allowed_consumers",
  "emergency_lkg_ttl_days",
  "fresh_ttl_hours",
  "providers",
  "recovery_green_required",
  "resolution_scope",
]);
const PROVIDER_KEYS = Object.freeze(["endpoint_family", "name", "schema"]);

function fail(message, options = {}) {
  throw new Error(`data-supply-policy-registry: ${message}`, options);
}

function stableJson(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) fail("non-finite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function assertNoDuplicateObjectKeys(text) {
  let offset = 0;
  const whitespace = () => {
    while (/\s/.test(text[offset] || "")) offset += 1;
  };
  const stringToken = () => {
    const start = offset;
    offset += 1;
    let escaped = false;
    while (offset < text.length) {
      const character = text[offset++];
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') return JSON.parse(text.slice(start, offset));
    }
    fail("registry is not strict JSON");
  };
  const value = () => {
    whitespace();
    if (text[offset] === "{") {
      offset += 1;
      const keys = new Set();
      whitespace();
      if (text[offset] === "}") { offset += 1; return; }
      while (offset < text.length) {
        whitespace();
        if (text[offset] !== '"') fail("registry is not strict JSON");
        const key = stringToken();
        if (keys.has(key)) fail(`duplicate JSON key: ${key}`);
        keys.add(key);
        whitespace();
        if (text[offset++] !== ":") fail("registry is not strict JSON");
        value();
        whitespace();
        const delimiter = text[offset++];
        if (delimiter === "}") return;
        if (delimiter !== ",") fail("registry is not strict JSON");
      }
      fail("registry is not strict JSON");
    }
    if (text[offset] === "[") {
      offset += 1;
      whitespace();
      if (text[offset] === "]") { offset += 1; return; }
      while (offset < text.length) {
        value();
        whitespace();
        const delimiter = text[offset++];
        if (delimiter === "]") return;
        if (delimiter !== ",") fail("registry is not strict JSON");
      }
      fail("registry is not strict JSON");
    }
    if (text[offset] === '"') { stringToken(); return; }
    const start = offset;
    while (offset < text.length && !/[\s,\]}]/.test(text[offset])) offset += 1;
    if (start === offset) fail("registry is not strict JSON");
    JSON.parse(text.slice(start, offset));
  };
  try {
    value();
    whitespace();
    if (offset !== text.length) fail("registry is not strict JSON");
  } catch (error) {
    if (String(error?.message || "").startsWith("data-supply-policy-registry:")) throw error;
    fail("registry is not strict JSON", { cause: error });
  }
}

function exactKeys(record, expected, label) {
  if (!record || typeof record !== "object" || Array.isArray(record)) fail(`${label} must be an object`);
  const actual = Object.keys(record).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) fail(`${label} keys are invalid`);
}

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_RE.test(value)) fail(`${label} must be a safe non-empty identifier`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) fail(`${label} must be a positive integer`);
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validateDomain(domain, record) {
  exactKeys(record, DOMAIN_KEYS, `domain ${domain}`);
  if (record.resolution_scope !== "domain_atomic") fail(`domain ${domain} resolution_scope must be domain_atomic`);
  if (!Array.isArray(record.providers) || record.providers.length !== 2) {
    fail(`domain ${domain} must declare exactly two ordered providers`);
  }
  record.providers.forEach((provider, index) => {
    exactKeys(provider, PROVIDER_KEYS, `${domain}.providers[${index}]`);
    const name = identifier(provider.name, `${domain}.providers[${index}].name`);
    if (!KNOWN_PROVIDERS.has(name)) fail(`${domain}.providers[${index}] is unknown: ${name}`);
    identifier(provider.endpoint_family, `${domain}.providers[${index}].endpoint_family`);
    if (typeof provider.schema !== "string" || !provider.schema || provider.schema.length > 128) {
      fail(`${domain}.providers[${index}].schema must be a non-empty label`);
    }
  });
  if (JSON.stringify(record.providers.map((provider) => provider.name)) !== JSON.stringify(EXPECTED_PROVIDER_ORDER)) {
    fail(`domain ${domain} provider order must preserve primary then fallback`);
  }
  positiveInteger(record.fresh_ttl_hours, `domain ${domain} fresh_ttl_hours`);
  positiveInteger(record.emergency_lkg_ttl_days, `domain ${domain} emergency_lkg_ttl_days`);
  positiveInteger(record.recovery_green_required, `domain ${domain} recovery_green_required`);
  if (!Array.isArray(record.allowed_consumers) || record.allowed_consumers.length === 0) {
    fail(`domain ${domain} allowed_consumers must be a non-empty array`);
  }
  record.allowed_consumers.forEach((consumer) => identifier(consumer, `domain ${domain} allowed_consumers`));
  if (new Set(record.allowed_consumers).size !== record.allowed_consumers.length) {
    fail(`domain ${domain} allowed_consumers contains duplicates`);
  }
}

export function policyRegistryDigest(registry) {
  const policy = { schema_version: registry.schema_version, domains: registry.domains };
  return crypto.createHash("sha256").update(stableJson(policy)).digest("hex");
}

export function loadDataSupplyPolicyRegistry(registryPath) {
  let text;
  try {
    text = fs.readFileSync(registryPath, "utf8");
  } catch (error) {
    fail(`registry read failed: ${registryPath}`, { cause: error });
  }
  assertNoDuplicateObjectKeys(text);
  let registry;
  try {
    registry = JSON.parse(text);
  } catch (error) {
    fail("registry is not strict JSON", { cause: error });
  }
  exactKeys(registry, ["schema_version", "policy_digest", "domains"], "registry");
  if (registry.schema_version !== DATA_SUPPLY_POLICY_REGISTRY_SCHEMA) fail("unsupported schema_version");
  if (!HEX64_RE.test(registry.policy_digest)) fail("policy_digest must be a lowercase SHA-256 digest");
  exactKeys(registry.domains, ENROLLED_DOMAINS, "domains");
  if (JSON.stringify(Object.keys(registry.domains)) !== JSON.stringify(ENROLLED_DOMAINS)) {
    fail("domains must use canonical order");
  }
  for (const domain of ENROLLED_DOMAINS) validateDomain(domain, registry.domains[domain]);
  if (policyRegistryDigest(registry) !== registry.policy_digest) {
    fail("policy_digest does not match canonical policy content");
  }
  return deepFreeze(registry);
}

export function getDataSupplyDomainPolicy(registry, domain, consumerId) {
  const policy = registry.domains[domain];
  if (!policy) fail(`domain ${domain} is not registered`);
  if (!policy.allowed_consumers.includes(consumerId)) {
    fail(`consumer ${consumerId} is not authorized for domain ${domain}`);
  }
  return policy;
}

export const DATA_SUPPLY_POLICY_REGISTRY = loadDataSupplyPolicyRegistry(DATA_SUPPLY_POLICY_REGISTRY_PATH);
