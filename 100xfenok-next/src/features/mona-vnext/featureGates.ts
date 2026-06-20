export type MonaVoiceCoachSurface = "winddown" | "debug";

type MonaVnextFeatureGateRegistry = {
  promoted: ReadonlySet<string>;
  experimental: ReadonlySet<string>;
};

export const MONA_VNEXT_PROMOTED_FEATURES = new Set<string>([]);
export const MONA_VNEXT_EXPERIMENTAL_FEATURES = new Set<string>([]);

export function createMonaVnextFeatureGateEvaluator(registry: MonaVnextFeatureGateRegistry) {
  const isEnabled = (key: string, surface: MonaVoiceCoachSurface) => {
    if (registry.promoted.has(key)) return true;
    if (registry.experimental.has(key)) return surface === "debug";
    return false;
  };

  return {
    isEnabled,
    listActiveExperimentalFeatures(surface: MonaVoiceCoachSurface) {
      if (surface !== "debug") return [];
      return [...registry.experimental].filter((key) => isEnabled(key, surface)).sort();
    },
  };
}

const ACTIVE_MONA_VNEXT_FEATURE_GATES = createMonaVnextFeatureGateEvaluator({
  promoted: MONA_VNEXT_PROMOTED_FEATURES,
  experimental: MONA_VNEXT_EXPERIMENTAL_FEATURES,
});

export function isMonaVnextFeatureEnabled(key: string, surface: MonaVoiceCoachSurface) {
  return ACTIVE_MONA_VNEXT_FEATURE_GATES.isEnabled(key, surface);
}

export function listActiveExperimentalFeatures(surface: MonaVoiceCoachSurface) {
  return ACTIVE_MONA_VNEXT_FEATURE_GATES.listActiveExperimentalFeatures(surface);
}
