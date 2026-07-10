export const DAILY_1Y_HISTORY_PROFILE = ["daily_1y"];

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
  };
}

export function isProfileConsistent(payload) {
  if (!payload?.report_profile || typeof payload.report_profile !== "object") return false;
  const profile = reportProfile(payload);
  return profile.required_history_periods.length > 0
    && profile.key === historyProfileKey(profile.required_history_periods)
    && profile.generated_at === payload?.generated_at;
}

export function isDaily1yReport(payload) {
  return isProfileConsistent(payload)
    && reportProfile(payload).key === historyProfileKey(DAILY_1Y_HISTORY_PROFILE);
}
