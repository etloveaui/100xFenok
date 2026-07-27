function nonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function buildEtfScoringLaneReadiness({
  signalGeneratedAt,
  signalAgeHours,
  historyGapGeneratedAt,
  historyGapAgeHours,
  maxAgeHours,
  publicReady,
  qaGateOk,
  classificationAsOf,
  scoredDenominatorCount,
  exactPlanScoredCount,
  scoredCompleteDaily1y,
  scoredFetchableDaily1yGap,
  scoredInceptionLimitedDaily1yGap,
  scoredTerminalLimitedDaily1yGap,
  exactPlanCountEquationOk,
  historyGapDaily1yMatches,
  fullPrimaryFetchableRequiredHistory,
  fullPrimaryMissingRequiredHistory,
  fullPrimaryInceptionLimitedRequiredHistory,
  fullPrimaryTerminalLimitedRequiredHistory,
  fullPrimaryFetchableRows,
}) {
  const scoredCounts = [
    scoredCompleteDaily1y,
    scoredFetchableDaily1yGap,
    scoredInceptionLimitedDaily1yGap,
    scoredTerminalLimitedDaily1yGap,
  ];
  const recomputedScoredTotal = scoredCounts.every(nonNegativeInteger)
    ? scoredCounts.reduce((sum, count) => sum + count, 0)
    : null;
  const exactPlanMatchesScoredDenominator = (
    nonNegativeInteger(scoredDenominatorCount)
    && nonNegativeInteger(exactPlanScoredCount)
    && exactPlanCountEquationOk === true
    && historyGapDaily1yMatches === true
    && recomputedScoredTotal === exactPlanScoredCount
    && exactPlanScoredCount === scoredDenominatorCount
  );

  const scoringLaneChecks = [
    {
      id: "etf_signal_summary_fresh",
      ok: signalAgeHours != null && signalAgeHours <= maxAgeHours,
      generated_at: signalGeneratedAt ?? null,
      age_hours: signalAgeHours,
      max_age_hours: maxAgeHours,
    },
    {
      id: "etf_history_gap_report_fresh",
      ok: historyGapAgeHours != null && historyGapAgeHours <= maxAgeHours,
      generated_at: historyGapGeneratedAt ?? null,
      age_hours: historyGapAgeHours,
      max_age_hours: maxAgeHours,
    },
    {
      id: "etf_scored_daily_1y_count_equation",
      ok: exactPlanMatchesScoredDenominator,
      classification_as_of: classificationAsOf ?? null,
      scored_denominator_count: scoredDenominatorCount,
      exact_plan_scored_count: exactPlanScoredCount,
      complete_daily_1y: scoredCompleteDaily1y,
      fetchable_daily_1y_gap: scoredFetchableDaily1yGap,
      inception_limited_daily_1y_gap: scoredInceptionLimitedDaily1yGap,
      terminal_limited_daily_1y_gap: scoredTerminalLimitedDaily1yGap,
      recomputed_total: recomputedScoredTotal,
      source_count_equation_ok: exactPlanCountEquationOk === true,
      history_gap_report_match: historyGapDaily1yMatches === true,
      claim_scope: "scored_eligible_etf_denominator",
      service_gate: true,
    },
    {
      id: "etf_no_fetchable_daily_1y_gap",
      ok: scoredFetchableDaily1yGap === 0,
      classification_as_of: classificationAsOf ?? null,
      fetchable_daily_1y_gap: scoredFetchableDaily1yGap,
      inception_limited_daily_1y_gap: scoredInceptionLimitedDaily1yGap,
      terminal_limited_daily_1y_gap: scoredTerminalLimitedDaily1yGap,
      history_gap_report_match: historyGapDaily1yMatches === true,
      claim_scope: "scored_eligible_etf_denominator",
      service_gate: true,
      caveat: "Only fetchable daily-1Y gaps inside the exact scored ETF plan block full ETF S3.",
    },
  ];
  const diagnosticChecks = [
    {
      id: "etf_no_fetchable_required_history_gap",
      ok: fullPrimaryFetchableRequiredHistory === 0,
      fetchable_required_history: fullPrimaryFetchableRequiredHistory,
      missing_required_history: fullPrimaryMissingRequiredHistory,
      inception_limited_required_history: fullPrimaryInceptionLimitedRequiredHistory,
      terminal_limited_required_history: fullPrimaryTerminalLimitedRequiredHistory,
      fetchable_rows: Array.isArray(fullPrimaryFetchableRows)
        ? fullPrimaryFetchableRows.map((row) => ({ ...row }))
        : [],
      claim_scope: "full_primary_etf_universe_diagnostic",
      service_gate: false,
      caveat: "Full-primary gaps outside the scored denominator remain visible for diagnostic backfill and do not block full ETF S3.",
    },
  ];
  const dailyBlockers = scoringLaneChecks.filter((check) => !check.ok).map((check) => check.id);
  const dailyReady = dailyBlockers.length === 0;
  const gatedChecks = [
    ...scoringLaneChecks,
    {
      id: "public_surface_proof",
      ok: publicReady === true,
      claim_scope: "scored_eligible_etf_denominator",
    },
    {
      id: "qa_fenok_etf_signal_gate",
      ok: qaGateOk === true,
      claim_scope: "scored_eligible_etf_denominator",
    },
  ];
  const gatedBlockers = gatedChecks.filter((check) => !check.ok).map((check) => check.id);

  return {
    dailyChecks: [...scoringLaneChecks, ...diagnosticChecks],
    scoringLaneChecks,
    gatedChecks,
    serviceChecks: scoringLaneChecks,
    diagnosticChecks,
    dailyReady,
    gatedReady: gatedBlockers.length === 0,
    dailyBlockers,
    gatedBlockers,
  };
}
