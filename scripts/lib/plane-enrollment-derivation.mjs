const PUBLIC_MANIFEST_PREFIXES = Object.freeze(["public/data/", "public/generated/"]);
export const PLANE_ENROLLMENT_SCHEMA_VERSION = "cloud-data-plane-enrollment/v1";

function invalid(message) {
  const error = new Error(`invalid plane enrollment: ${message}`);
  error.code = "PLANE_ENROLLMENT_INVALID";
  return error;
}

function requireCleanSegments(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(`${label} must be a non-empty string`);
  }
  if (value.includes("\\")) throw invalid(`${label} must use URL separators`);
  if (/[?#%\u0000-\u001f\u007f]/u.test(value)) {
    throw invalid(`${label} contains URL syntax or control characters`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw invalid(`${label} contains an empty or dot segment`);
  }
  return segments;
}

function publicUrlPrefix(manifestPrefix, familyName) {
  if (typeof manifestPrefix !== "string"
    || !PUBLIC_MANIFEST_PREFIXES.some((prefix) => manifestPrefix.startsWith(prefix))) {
    throw invalid(`${familyName}.manifest_prefix must start with public/data/ or public/generated/`);
  }
  const segments = requireCleanSegments(manifestPrefix, `${familyName}.manifest_prefix`);
  if (segments[0] !== "public" || segments.length === 1) {
    throw invalid(`${familyName}.manifest_prefix must contain a public path`);
  }
  return `/${segments.slice(1).join("/")}`;
}

function publicUrlForFile(prefix, file, familyName) {
  const fileSegments = requireCleanSegments(file, `${familyName}.files entry`);
  return `${prefix}/${fileSegments.join("/")}`;
}

function assertFamilyName(familyName) {
  if (typeof familyName !== "string" || familyName.length === 0) {
    throw invalid("family names must be non-empty strings");
  }
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertNoCrossFamilyOverlap(exact, prefixes) {
  const exactOwners = new Map();
  for (const [pathname, family] of exact) {
    const previous = exactOwners.get(pathname);
    if (previous !== undefined) throw invalid(`duplicate exact path ${pathname}`);
    exactOwners.set(pathname, family);
  }

  const prefixOwners = new Map();
  for (const { prefix, family } of prefixes) {
    const previous = prefixOwners.get(prefix);
    if (previous !== undefined) throw invalid(`duplicate prefix ${prefix}`);
    prefixOwners.set(prefix, family);
  }

  for (const [pathname, family] of exact) {
    for (const { prefix, family: prefixFamily } of prefixes) {
      if (family !== prefixFamily && pathname.startsWith(prefix)) {
        throw invalid(`cross-family exact/prefix overlap ${pathname} and ${prefix}`);
      }
    }
  }

  for (let leftIndex = 0; leftIndex < prefixes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < prefixes.length; rightIndex += 1) {
      const left = prefixes[leftIndex];
      const right = prefixes[rightIndex];
      if (left.family !== right.family
        && (left.prefix.startsWith(right.prefix) || right.prefix.startsWith(left.prefix))) {
        throw invalid(`cross-family prefix overlap ${left.prefix} and ${right.prefix}`);
      }
    }
  }
}

export function derivePublicPlaneEnrollment(families) {
  if (families === null || typeof families !== "object" || Array.isArray(families)) {
    throw invalid("families must be an object");
  }

  const exact = [];
  const prefixes = [];
  for (const [familyName, family] of Object.entries(families)) {
    assertFamilyName(familyName);
    if (family === null || typeof family !== "object" || Array.isArray(family)) {
      throw invalid(`${familyName} must be an object`);
    }
    if (family.privacy_class !== "public" && family.privacy_class !== "private") {
      throw invalid(`${familyName}.privacy_class must be public or private`);
    }
    if (family.privacy_class !== "public") continue;

    const prefix = publicUrlPrefix(family.manifest_prefix, familyName);
    if (family.files === undefined) {
      prefixes.push({ prefix: `${prefix}/`, family: familyName });
      continue;
    }
    if (!Array.isArray(family.files)) throw invalid(`${familyName}.files must be an array`);
    for (const file of family.files) exact.push([publicUrlForFile(prefix, file, familyName), familyName]);
  }

  exact.sort(([leftPath, leftFamily], [rightPath, rightFamily]) => (
    compareStrings(leftPath, rightPath) || compareStrings(leftFamily, rightFamily)
  ));
  prefixes.sort((left, right) => (
    compareStrings(left.prefix, right.prefix) || compareStrings(left.family, right.family)
  ));
  assertNoCrossFamilyOverlap(exact, prefixes);

  return Object.freeze({
    schema_version: PLANE_ENROLLMENT_SCHEMA_VERSION,
    exact: Object.freeze(exact),
    prefixes: Object.freeze(prefixes),
  });
}

export function derivePrivatePlaneDeny(fileOutputs) {
  if (!Array.isArray(fileOutputs)) {
    throw invalid("private deny file outputs must be an array");
  }

  const paths = fileOutputs.map((file, index) => {
    const segments = requireCleanSegments(file, `private deny file outputs entry ${index}`);
    if (segments[0] !== "data" || segments.length === 1) {
      throw invalid(`private deny file outputs entry ${index} must start with data/`);
    }
    return `/${segments.join("/")}`;
  });
  const uniquePaths = new Set(paths);
  if (uniquePaths.size !== paths.length) throw invalid("duplicate private deny path");

  return Object.freeze(paths.sort(compareStrings));
}

function assertSchema(schema) {
  if (schema?.schema_version !== PLANE_ENROLLMENT_SCHEMA_VERSION
    || !Array.isArray(schema.exact)
    || !Array.isArray(schema.prefixes)) {
    throw invalid("schema shape or version is invalid");
  }
}

function assertPrivateDeny(privateDeny) {
  if (!Array.isArray(privateDeny)) throw invalid("private deny must be an array");
  const normalized = derivePrivatePlaneDeny(privateDeny.map((pathname, index) => {
    if (typeof pathname !== "string" || !pathname.startsWith("/")) {
      throw invalid(`private deny entry ${index} must be an absolute URL path`);
    }
    return pathname.slice(1);
  }));
  if (normalized.length !== privateDeny.length
    || normalized.some((pathname, index) => pathname !== privateDeny[index])) {
    throw invalid("private deny paths must be sorted and unique");
  }
}

export function renderPlaneEnrollmentModule(schema, privateDeny = []) {
  assertSchema(schema);
  assertPrivateDeny(privateDeny);
  const exact = [...schema.exact]
    .sort(([leftPath, leftFamily], [rightPath, rightFamily]) => (
      compareStrings(leftPath, rightPath) || compareStrings(leftFamily, rightFamily)
    ))
    .map((entry) => `  ${JSON.stringify(entry)},`)
    .join("\n");
  const prefixes = [...schema.prefixes]
    .sort((left, right) => (
      compareStrings(left.prefix, right.prefix) || compareStrings(left.family, right.family)
    ))
    .map((entry) => `  ${JSON.stringify(entry)},`)
    .join("\n");
  const renderedPrivateDeny = privateDeny
    .map((pathname) => `  ${JSON.stringify(pathname)},`)
    .join("\n");
  return [
    `export const PLANE_ENROLLMENT_SCHEMA_VERSION = ${JSON.stringify(schema.schema_version)};`,
    "export const PLANE_ENROLLMENT_EXACT = Object.freeze([",
    exact,
    "]);",
    "export const PLANE_ENROLLMENT_PREFIXES = Object.freeze([",
    prefixes,
    "]);",
    "export const PLANE_ENROLLMENT_PRIVATE_DENY = Object.freeze([",
    renderedPrivateDeny,
    "]);",
    "",
  ].join("\n");
}
