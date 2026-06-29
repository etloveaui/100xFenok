// Pure stock-action scoring core shared by the S0 generator and S1 preview audits.
export const ACTION_SCORE_CONFIG = Object.freeze({
  schema_version: 2,
  confidenceBlend: {
    signalWeight: 0.7,
    coverageWeight: 0.3,
  },
  confidenceThresholds: {
    high: 0.75,
    medium: 0.5,
  },
  evidenceGuard: {
    minEligibleFamiliesForAction: 3,
    minPresentFamiliesForAction: 3,
    lowEvidenceActionScoreCap: 49,
  },
  familyMax: {
    valuation: 20,
    momentum_revision: 22,
    income: 10,
    index_structure: 18,
    smart_money: 25,
    sector_smart_money: 5,
  },
  bucketThresholds: {
    smart_money: { minSmartMoneyPct: 0.5, minCoverageRatio: 0.5 },
    value_momentum: { minValuationPct: 0.5, minMomentumPct: 0.4, minCoverageRatio: 0.5 },
    index_core: { minIndexPct: 0.5, minCoverageRatio: 0.5 },
    income: { minIncomePct: 0.75, minCoverageRatio: 0.5 },
    momentum: { minMomentumPct: 0.55, minCoverageRatio: 0.5 },
  },
});

export function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function num(value) {
  return finite(value) ? value : null;
}

export function round(value, digits = 4) {
  return finite(value) ? Number(value.toFixed(digits)) : null;
}

export function normalizeTicker(symbol) {
  const raw = String(symbol ?? "").trim().toUpperCase();
  if (!raw) return { ticker_normalized: "", market: "unknown" };
  if (raw.endsWith(".KS")) return { ticker_normalized: raw.replace(".KS", ""), market: "KRX" };
  if (raw.endsWith(".KQ")) return { ticker_normalized: raw.replace(".KQ", ""), market: "KOSDAQ" };
  if (raw.endsWith(".HK")) return { ticker_normalized: raw.replace(".HK", ""), market: "HKEX" };
  if (raw.endsWith(".SZ")) return { ticker_normalized: raw.replace(".SZ", ""), market: "SZSE" };
  if (raw.endsWith(".SS")) return { ticker_normalized: raw.replace(".SS", ""), market: "SSE" };
  if (/^\d{4,6}$/.test(raw)) return { ticker_normalized: raw, market: "ASIA" };
  if (raw.includes(".")) return { ticker_normalized: raw.replace(".", "-"), market: "US_CLASS" };
  return { ticker_normalized: raw, market: "US" };
}

export function qualityFlags(stock, context) {
  const flags = [];
  if (stock.price === null || stock.price === undefined) flags.push("missing_price");
  if (stock.peForward === null || stock.peForward === undefined) flags.push("missing_forward_pe");
  if (stock.epsForward === null || stock.epsForward === undefined) flags.push("missing_forward_eps");
  if (!context.quarterClose) flags.push("missing_quarter_close_history");
  if (context.dividendHistory?.historyCount === 0) flags.push("no_dividend_history");
  if (context.convictionNameOnly) flags.push("conviction_name_not_ticker");
  return flags;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function marketScopeFromMarket(market) {
  if (market === "US" || market === "US_CLASS") return "us";
  if (market === "KRX" || market === "KOSDAQ") return "korea";
  if (market === "HKEX" || market === "SSE" || market === "SZSE" || market === "ASIA") return "asia";
  return "other";
}

function actionFamily(key, { eligible, present, score, reason = null }) {
  const max = ACTION_SCORE_CONFIG.familyMax[key];
  const isEligible = Boolean(eligible);
  const isPresent = Boolean(isEligible && present);
  return {
    key,
    eligible: isEligible,
    present: isPresent,
    score: isPresent ? round(clamp(score ?? 0, 0, max), 2) : 0,
    max,
    reason,
  };
}

function compactFamily(family) {
  return {
    present: family.present,
    eligible: family.eligible,
    score: family.score,
    max: family.max,
  };
}

function familyPct(family) {
  return family?.present && family.max > 0 ? family.score / family.max : 0;
}

function perBandPct(stock) {
  const current = num(stock.perBandCurrent);
  const min = num(stock.perBandMin);
  const max = num(stock.perBandMax);
  if (current === null || min === null || max === null || max <= min) return null;
  return clamp((current - min) / (max - min), 0, 1);
}

function perBandLabel(pct) {
  if (pct === null) return "밴드 없음";
  if (pct <= 0.25) return "저평가권";
  if (pct >= 0.75) return "고평가권";
  return "중립권";
}

function valuationFamily(stock) {
  const bandPct = perBandPct(stock);
  const peForward = num(stock.peForward);
  const per = num(stock.per);
  const fallbackPe = peForward ?? per;
  if (bandPct !== null) {
    const score = bandPct <= 0.25 ? 20 : bandPct <= 0.5 ? 14 : bandPct < 0.75 ? 8 : 2;
    return actionFamily("valuation", {
      eligible: true,
      present: true,
      score,
      reason: `PER 밴드 ${Math.round(bandPct * 100)}%`,
    });
  }
  if (fallbackPe !== null && fallbackPe > 0) {
    const score = fallbackPe <= 15 ? 14 : fallbackPe <= 25 ? 10 : fallbackPe <= 35 ? 6 : 2;
    return actionFamily("valuation", {
      eligible: true,
      present: true,
      score,
      reason: `${peForward !== null ? "Fwd " : ""}PER ${fallbackPe.toFixed(1)}`,
    });
  }
  return actionFamily("valuation", { eligible: false, present: false, score: 0 });
}

function momentumRevisionFamily(stock, revision) {
  const ret12m = num(stock.return12m);
  const momentum3m = num(stock.momentum3m ?? stock.growthRate);
  const eligible = ret12m !== null || momentum3m !== null || revision != null;
  let score = 0;
  const reasons = [];
  if (ret12m !== null) {
    score += ret12m >= 0.25 ? 8 : ret12m >= 0 ? 5 : ret12m >= -0.2 ? 2 : 1;
    reasons.push(`12M ${(ret12m * 100).toFixed(1)}%`);
  }
  if (momentum3m !== null) {
    score += momentum3m >= 0.1 ? 6 : momentum3m >= 0 ? 3 : 1;
  }
  if (revision?.direction === "up") {
    score += 8;
    reasons.push(`EPS 상향 ${revision.change1w?.toFixed(1) ?? "—"}`);
  } else if (revision?.direction === "down") {
    score += 1;
    reasons.push(`EPS 하향 ${revision.change1w?.toFixed(1) ?? "—"}`);
  }
  return actionFamily("momentum_revision", {
    eligible,
    present: eligible,
    score,
    reason: reasons[0] ?? null,
  });
}

function incomeFamily(stock, dividendHistory) {
  const dividendYield = num(stock.dividendYield);
  const ttm = num(dividendHistory?.ttm);
  const eligible = dividendYield !== null || ttm !== null || dividendHistory?.historyCount > 0;
  let score = 0;
  let reason = null;
  if (dividendYield !== null) {
    score = dividendYield >= 0.04 ? 10 : dividendYield >= 0.03 ? 8 : dividendYield >= 0.015 ? 5 : dividendYield > 0 ? 2 : 0;
    reason = `배당 ${(dividendYield * 100).toFixed(1)}%`;
  } else if (ttm !== null && ttm > 0) {
    score = 3;
    reason = `TTM 배당 ${ttm.toFixed(2)}`;
  }
  return actionFamily("income", {
    eligible,
    present: eligible,
    score,
    reason,
  });
}

function indexStructureFamily(context) {
  const memberships = context.universe?.indices ?? [];
  const weights = context.weights ?? [];
  const maxWeight = weights.reduce((max, row) => Math.max(max, finite(row.weight) ? row.weight : 0), 0);
  const eligible = context.marketScope === "us" || memberships.length > 0 || weights.length > 0;
  const present = memberships.length > 0 || weights.length > 0;
  const score = memberships.length * 4 + (maxWeight >= 2 ? Math.min(10, maxWeight * 1.2) : maxWeight > 0 ? 2 : 0);
  const reason = present
    ? `${memberships.length > 0 ? memberships.join("/") : "index"}${maxWeight > 0 ? ` ${maxWeight.toFixed(1)}%` : ""}`
    : null;
  return actionFamily("index_structure", { eligible, present, score, reason });
}

function smartMoneyFamily(context) {
  const guru = context.guruHolders;
  const consensus = context.consensus;
  const conviction = context.conviction;
  const eligible = context.marketScope === "us" || finite(guru) || consensus != null || conviction != null;
  const present = finite(guru) || finite(consensus?.equity_score) || conviction != null;
  let score = 0;
  const reasons = [];
  if (finite(guru)) {
    score += Math.min(10, guru);
    const equityHolders = num(consensus?.equity_holders ?? consensus?.equityHolders);
    const totalHolders = num(consensus?.total_holders ?? consensus?.totalHolders);
    if (finite(equityHolders) && finite(totalHolders) && totalHolders > equityHolders) {
      reasons.push(`기관 공시 주식 ${equityHolders}명 · 옵션/클래스 포함 ${totalHolders}명`);
    } else if (guru >= 5) {
      reasons.push(`고수 보유 ${guru}명`);
    }
  }
  if (finite(consensus?.equity_score)) {
    score += consensus.equity_score * 8;
    if (consensus.equity_score >= 0.5) reasons.push(`기관 공시 컨센서스 ${consensus.equity_score.toFixed(2)}`);
  }
  if (conviction) {
    score += Math.min(7, conviction.count * 2 + (conviction.maxWeight ?? 0) * 50);
    reasons.push(`고확신 기관 공시 ${conviction.count}건`);
  }
  return actionFamily("smart_money", {
    eligible,
    present,
    score,
    reason: reasons[0] ?? null,
  });
}

function sectorSmartMoneyFamily(context) {
  const sector = context.sectorSmartMoney;
  const eligible = context.canonicalSector !== "Other" && sector != null;
  const present = eligible && finite(sector.investorCount);
  const score = present ? Math.min(5, sector.investorCount / 8 + (sector.avgWeight ?? 0) * 50) : 0;
  const reason = present ? `섹터 기관 관심 ${context.canonicalSector} ${sector.investorCount}명` : null;
  return actionFamily("sector_smart_money", { eligible, present, score, reason });
}

function summarizeActionFamilies(families) {
  const all = Object.values(families);
  const eligible = all.filter((family) => family.eligible);
  const present = eligible.filter((family) => family.present);
  const presentMax = present.reduce((sum, family) => sum + family.max, 0);
  const eligibleMax = eligible.reduce((sum, family) => sum + family.max, 0);
  const familyScore = present.reduce((sum, family) => sum + family.score, 0);
  const signalScore = presentMax > 0 ? (familyScore / presentMax) * 100 : 0;
  const coverageRatio = eligibleMax > 0 ? presentMax / eligibleMax : 0;
  const blend = ACTION_SCORE_CONFIG.confidenceBlend;
  const rawActionScore = signalScore * (blend.signalWeight + blend.coverageWeight * coverageRatio);
  const lowEvidence =
    eligible.length < ACTION_SCORE_CONFIG.evidenceGuard.minEligibleFamiliesForAction ||
    present.length < ACTION_SCORE_CONFIG.evidenceGuard.minPresentFamiliesForAction;
  const actionScore = lowEvidence
    ? Math.min(rawActionScore, ACTION_SCORE_CONFIG.evidenceGuard.lowEvidenceActionScoreCap)
    : rawActionScore;
  const confidenceLabel =
    lowEvidence
      ? "low"
      : coverageRatio >= ACTION_SCORE_CONFIG.confidenceThresholds.high
      ? "high"
      : coverageRatio >= ACTION_SCORE_CONFIG.confidenceThresholds.medium
        ? "medium"
        : "low";
  return {
    signalScore: round(signalScore, 2),
    coverageRatio: round(coverageRatio, 4),
    actionScore: round(actionScore, 2),
    confidenceLabel,
    eligibleFamilyCount: eligible.length,
    presentFamilyCount: present.length,
    lowEvidence,
  };
}

function selectActionBucket(families, summary) {
  const thresholds = ACTION_SCORE_CONFIG.bucketThresholds;
  const coverage = summary.coverageRatio ?? 0;
  const p = {
    valuation: familyPct(families.valuation),
    momentum_revision: familyPct(families.momentum_revision),
    income: familyPct(families.income),
    index_structure: familyPct(families.index_structure),
    smart_money: familyPct(families.smart_money),
  };
  if (summary.lowEvidence) return { bucket: "watch", label: "관찰" };

  const candidates = [];
  if (p.smart_money >= thresholds.smart_money.minSmartMoneyPct && coverage >= thresholds.smart_money.minCoverageRatio) {
    candidates.push({ bucket: "smart_money", label: "기관/고수 주목", strength: p.smart_money });
  }
  if (
    p.valuation >= thresholds.value_momentum.minValuationPct &&
    p.momentum_revision >= thresholds.value_momentum.minMomentumPct &&
    coverage >= thresholds.value_momentum.minCoverageRatio
  ) {
    candidates.push({ bucket: "value_momentum", label: "밸류+모멘텀", strength: (p.valuation + p.momentum_revision) / 2 });
  }
  if (p.index_structure >= thresholds.index_core.minIndexPct && coverage >= thresholds.index_core.minCoverageRatio) {
    candidates.push({ bucket: "index_core", label: "지수 핵심", strength: p.index_structure });
  }
  if (p.income >= thresholds.income.minIncomePct && coverage >= thresholds.income.minCoverageRatio) {
    candidates.push({ bucket: "income", label: "배당 점검", strength: p.income });
  }
  if (p.momentum_revision >= thresholds.momentum.minMomentumPct && coverage >= thresholds.momentum.minCoverageRatio) {
    candidates.push({ bucket: "momentum", label: "모멘텀 리더", strength: p.momentum_revision });
  }

  const selected = candidates.sort((a, b) => b.strength - a.strength)[0];
  return selected ? { bucket: selected.bucket, label: selected.label } : { bucket: "watch", label: "관찰" };
}

export function actionFrom(stock, context) {
  const familyList = [
    valuationFamily(stock),
    momentumRevisionFamily(stock, context.revision),
    incomeFamily(stock, context.dividendHistory),
    indexStructureFamily(context),
    smartMoneyFamily(context),
    sectorSmartMoneyFamily(context),
  ];
  const families = Object.fromEntries(familyList.map((family) => [family.key, family]));
  const summary = summarizeActionFamilies(families);
  const selected = selectActionBucket(families, summary);
  let reasons = familyList
    .filter((family) => family.present && family.reason)
    .sort((a, b) => b.score / b.max - a.score / a.max)
    .map((family) => family.reason);
  const equityHolders = num(context.consensus?.equity_holders ?? context.consensus?.equityHolders);
  const totalHolders = num(context.consensus?.total_holders ?? context.consensus?.totalHolders);
  if (finite(equityHolders) && finite(totalHolders) && totalHolders > equityHolders) {
    const smartReason = `기관 공시 주식 ${equityHolders}명 · 옵션/클래스 포함 ${totalHolders}명`;
    reasons = [smartReason, ...reasons.filter((reason) => reason !== smartReason)];
  }
  if (summary.lowEvidence) reasons.push("증거 부족");

  return {
    actionScore: summary.actionScore,
    signalScore: summary.signalScore,
    coverageRatio: summary.coverageRatio,
    confidenceLabel: summary.confidenceLabel,
    eligibleFamilyCount: summary.eligibleFamilyCount,
    presentFamilyCount: summary.presentFamilyCount,
    actionLabel: selected.label,
    actionBucket: selected.bucket,
    actionReasons: reasons.slice(0, 4),
    families: Object.fromEntries(Object.entries(families).map(([key, family]) => [key, compactFamily(family)])),
    scoreQualityFlags: summary.lowEvidence ? ["low_evidence"] : [],
    perBandPct: perBandPct(stock) !== null ? round(perBandPct(stock), 4) : null,
    perBandLabel: perBandLabel(perBandPct(stock)),
  };
}
