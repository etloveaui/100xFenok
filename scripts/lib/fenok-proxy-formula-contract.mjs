export const FLOW_PROXY_FORMULA_VERSION = "fenok-flow-proxies-v0.3-short-pressure-calibration";
export const OCC_OPTIONS_FORMULA_VERSION = "fenok-occ-options-volume-v0.2-volume-skew-calibration";

export function assertProxyFormulaVersion(payload, expectedVersion, sourceLabel) {
  if (payload == null) return;
  const actualVersion = payload.formula_version ?? "missing";
  if (actualVersion !== expectedVersion) {
    throw new Error(`${sourceLabel} formula_version must be ${expectedVersion}; got ${actualVersion}`);
  }
}
