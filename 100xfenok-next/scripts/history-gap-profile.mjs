export const DAILY_1Y_HISTORY_PROFILE = ["daily_1y"];

function canonicalUtcIso(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) return null;
  const canonical = parsed.toISOString();
  return value === canonical ? canonical : null;
}

export function historyProfileKey(periods) {
  return (Array.isArray(periods) ? periods : [])
    .map((period) => String(period).trim())
    .filter(Boolean)
    .sort()
    .join(",");
}

export function reportProfile(payload) {
  const periods = payload?.report_profile?.required_history_periods ?? payload?.required_history_periods;
  return {
    key: payload?.report_profile?.key ?? historyProfileKey(periods),
    required_history_periods: Array.isArray(periods) ? periods.map(String).sort() : [],
    generated_at: payload?.report_profile?.generated_at ?? payload?.generated_at ?? null,
    classification_as_of: payload?.report_profile?.classification_as_of ?? payload?.classification_as_of ?? null,
  };
}

export function reportClassificationDate(payload) {
  if (!isProfileConsistent(payload)) return null;
  const classificationAsOf = canonicalUtcIso(reportProfile(payload).classification_as_of);
  return classificationAsOf ? new Date(classificationAsOf) : null;
}

export function isProfileConsistent(payload) {
  if (!payload?.report_profile || typeof payload.report_profile !== "object") return false;
  const profile = reportProfile(payload);
  const generatedAt = canonicalUtcIso(payload?.generated_at);
  const classificationAsOf = canonicalUtcIso(payload?.classification_as_of);
  const profileGeneratedAt = canonicalUtcIso(payload?.report_profile?.generated_at);
  const profileClassificationAsOf = canonicalUtcIso(payload?.report_profile?.classification_as_of);
  return profile.required_history_periods.length > 0
    && profile.key === historyProfileKey(profile.required_history_periods)
    && generatedAt !== null
    && classificationAsOf !== null
    && profileGeneratedAt === generatedAt
    && profileClassificationAsOf === classificationAsOf
    && new Date(classificationAsOf).valueOf() <= new Date(generatedAt).valueOf();
}

export function isDaily1yReport(payload) {
  return isProfileConsistent(payload)
    && reportProfile(payload).key === historyProfileKey(DAILY_1Y_HISTORY_PROFILE);
}
