export const MONA_VNEXT_LOG_NAMESPACE = "voice-logs-vnext";
export const MONA_VNEXT_DATA_NAMESPACE = "mona-vnext";

export const MONA_VNEXT_NAMESPACE_POLICY = {
  productionWriteEnabled: false,
  logRoot: `data/${MONA_VNEXT_LOG_NAMESPACE}`,
  dataRoot: `data/${MONA_VNEXT_DATA_NAMESPACE}`,
  rule: "vNext alpha must not write current production Mona data.",
} as const;

export type MonaVnextNamespacePolicy = typeof MONA_VNEXT_NAMESPACE_POLICY;
