import fs from "node:fs";

function fail(filePath, reason) {
  throw new Error(`[schema-guard] ${filePath}: ${reason}`);
}

export function requireObject(value, filePath, field = "root") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(filePath, `${field} must be an object`);
  }
  return value;
}

export function requireArray(value, filePath, field) {
  if (!Array.isArray(value)) {
    fail(filePath, `${field} must be an array`);
  }
  return value;
}

export function requireKeys(value, filePath, keys, field = "root") {
  requireObject(value, filePath, field);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      fail(filePath, `${field}.${key} is required`);
    }
  }
  return value;
}

export function requireNumber(value, filePath, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(filePath, `${field} must be a finite number`);
  }
  return value;
}

export function loadJsonGuarded(filePath, guardFn) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(filePath, `failed to read/parse JSON (${error instanceof Error ? error.message : String(error)})`);
  }

  try {
    guardFn?.(data, filePath);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("[schema-guard] ")) {
      throw error;
    }
    fail(filePath, error instanceof Error ? error.message : "schema validation failed");
  }

  return data;
}
