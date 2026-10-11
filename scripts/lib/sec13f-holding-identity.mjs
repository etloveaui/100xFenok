const CUSIP_RE = /^[A-Z0-9]{9}$/;
const PUT_CALL_VALUES = new Set(["COMMON", "PUT", "CALL"]);
const SHARE_TYPE_VALUES = new Set(["SH", "PRN"]);
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function normalizedCusip(value) {
  const cusip = typeof value === "string" ? value.trim().toUpperCase() : "";
  return CUSIP_RE.test(cusip) ? cusip : null;
}

function normalizedEnum(value, allowed) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return allowed.has(normalized) ? normalized : null;
}

function holdingIdentity(holding) {
  if (!holding || typeof holding !== "object" || Array.isArray(holding)) return null;
  const cusip = normalizedCusip(holding.cusip);
  if (!cusip) return null;

  const putCall = OWN(holding, "put_call")
    ? normalizedEnum(holding.put_call, PUT_CALL_VALUES)
    : "COMMON";
  if (!putCall) return null;

  const unitFields = ["share_type", "ssh_prnamt_type"].filter((key) => OWN(holding, key));
  const units = unitFields.map((key) => normalizedEnum(holding[key], SHARE_TYPE_VALUES));
  if (units.some((unit) => unit === null) || new Set(units).size > 1) return null;
  const shareType = units[0] ?? "SH";
  return {
    cusip,
    put_call: putCall,
    share_type: shareType,
    security_key: `${cusip}|${putCall}|${shareType}`,
  };
}

function confirmedSymbol(holding) {
  const symbol = holding && OWN(holding, "resolved_ticker") ? holding.resolved_ticker : null;
  return typeof symbol === "string" && symbol.trim()
    ? symbol.trim().toUpperCase().replaceAll("-", ".") : null;
}

/** Classify the reported position separately from its underlying ticker.
 * provider_unsupported describes this resolver's evidence boundary, not an
 * assertion that a security is unlisted or absent from every data provider.
 */
export function classifyHoldingResolution(holding, resolution) {
  const title = String(holding?.title_of_class ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const putCall = String(holding?.put_call ?? "").trim().toUpperCase();
  const units = [holding?.share_type, holding?.ssh_prnamt_type]
    .map((value) => String(value ?? "").trim().toUpperCase());
  const result = (outcome, reason, evidence) => ({ outcome, reason, evidence,
    equity_holder_eligible: outcome === "confirmed_security" });
  if (["PUT", "CALL"].includes(putCall) || /\bOPTION\b/.test(title)) {
    return result("not_equity_holding", "reported_option", "reported:put_call,title_of_class");
  }
  if (units.includes("PRN") || /^(?:(?:CONVERTIBLE|CONV|SENIOR|SR|SUBORDINATED)\s+)*(?:NOTE|BOND|DEBENTURE)\b/.test(title)) {
    return result("not_equity_holding", "reported_debt", "reported:share_type,ssh_prnamt_type,title_of_class");
  }
  if (/\bWARRANTS?\b|\bW EXP\b/.test(title)) {
    return result("not_equity_holding", "reported_warrant", "reported:title_of_class");
  }
  // A dated acquisition unit bundles securities. ETF trust and partnership
  // units are not assumed to be the same instrument from the word UNIT alone.
  if (/^UNITS?\s+\d{2}\/\d{2}\/\d{4}$/.test(title)) {
    return result("not_equity_holding", "reported_bundled_unit", "reported:title_of_class");
  }
  if (putCall && putCall !== "COMMON") {
    return result("provider_unsupported", "unrecognized_position_type", "reported:put_call");
  }
  if (resolution?.symbol) {
    return result("confirmed_security", "existing_resolver_binding", `resolver:${resolution.source ?? "confirmed"}`);
  }
  let reason = "exact_cusip_class_ticker_not_confirmed";
  if (!normalizedCusip(holding?.cusip)) reason = "missing_or_invalid_cusip";
  else if (!title) reason = "missing_reported_security_class";
  else if (/\b(?:ADR|ADS|SPONSORED|SPONSORD)\b/.test(title)) reason = "depositary_receipt_class_ticker_not_confirmed";
  else if (/\b(?:ETF|FUND|TRUST|UNIT|UT)\b/.test(title)) reason = "fund_or_unit_class_ticker_not_confirmed";
  else if (/^[A-Z]/.test(normalizedCusip(holding.cusip))) reason = "foreign_cusip_us_trading_class_not_confirmed";
  return result("provider_unsupported", reason, `resolver:${resolution?.source ?? "unmapped"}`);
}

/** Add confirmed security identity without changing any reported 13F field. */
export function annotateHoldingIdentity(holding, resolver) {
  const raw = holding && typeof holding === "object" && !Array.isArray(holding) ? holding : {};
  const result = typeof resolver?.resolveHoldingSymbol === "function"
    ? resolver.resolveHoldingSymbol(raw)
    : null;
  const symbol = typeof result?.symbol === "string" && result.symbol.trim()
    ? result.symbol.trim().toUpperCase()
    : null;
  return { ...raw, resolved_ticker: symbol, security_key: holdingIdentity(raw)?.security_key ?? null,
    resolution_classification: classifyHoldingResolution(raw, result) };
}

function quarterOrdinal(value) {
  const match = typeof value === "string" ? /^(\d{4})-Q([1-4])$/.exec(value) : null;
  return match ? Number(match[1]) * 4 + Number(match[2]) - 1 : null;
}

function collectGroups(filing) {
  const groups = new Map();
  const ambiguousCusips = new Set();
  let unkeyedRows = 0;
  for (const holding of filing.holdings) {
    const identity = holdingIdentity(holding);
    if (!identity) {
      unkeyedRows += 1;
      const cusip = normalizedCusip(holding?.cusip);
      if (cusip) ambiguousCusips.add(cusip);
      continue;
    }
    const group = groups.get(identity.security_key) ?? {
      ...identity, rows: 0, shares: 0, invalidShares: false,
      symbols: new Set(), unresolvedSymbol: false, representative: null,
    };
    group.rows += 1;
    const shares = holding.shares;
    if (typeof shares !== "number" || !Number.isFinite(shares) || shares <= 0) {
      group.invalidShares = true;
    } else {
      group.shares += shares;
      if (!Number.isFinite(group.shares)) group.invalidShares = true;
    }
    const symbol = confirmedSymbol(holding);
    if (symbol) group.symbols.add(symbol);
    else group.unresolvedSymbol = true;
    if (!group.representative || !group.representative.name && holding.name) {
      group.representative = holding;
    }
    groups.set(identity.security_key, group);
  }
  return { groups, ambiguousCusips, unkeyedRows };
}

function eventEntry(key, current, previous, changePct) {
  const selected = current ?? previous;
  const symbols = new Set([...(current?.symbols ?? []), ...(previous?.symbols ?? [])]);
  const unresolved = Boolean(current?.unresolvedSymbol || previous?.unresolvedSymbol);
  const symbol = !unresolved && symbols.size === 1 ? [...symbols][0] : null;
  const representative = selected.representative ?? {};
  return {
    security_key: key,
    cusip: selected.cusip,
    title_of_class: representative.title_of_class ?? null,
    put_call: selected.put_call,
    share_type: selected.share_type,
    resolved_ticker: symbol,
    ticker: symbol,
    name: representative.name ?? null,
    change_pct: changePct,
  };
}

/** Compare reported positive share quantities for exact adjacent 13F quarters. */
export function buildConfirmedChanges(currentFiling, previousFiling) {
  const currentOrdinal = quarterOrdinal(currentFiling?.quarter);
  const previousOrdinal = quarterOrdinal(previousFiling?.quarter);
  if (currentOrdinal === null || previousOrdinal === null || currentOrdinal !== previousOrdinal + 1
    || !Array.isArray(currentFiling?.holdings) || !Array.isArray(previousFiling?.holdings)) {
    return null;
  }

  const current = collectGroups(currentFiling);
  const previous = collectGroups(previousFiling);
  const changes = {
    comparison_basis: "reported_security_shares",
    previous_quarter: previousFiling.quarter,
    new: [], increased: [], decreased: [], sold: [],
    uncomparable_rows: current.unkeyedRows + previous.unkeyedRows,
  };
  const keys = new Set([...current.groups.keys(), ...previous.groups.keys()]);
  for (const key of [...keys].sort()) {
    const latest = current.groups.get(key);
    const prior = previous.groups.get(key);
    const cusip = (latest ?? prior).cusip;
    if (current.ambiguousCusips.has(cusip) || previous.ambiguousCusips.has(cusip)
      || latest?.invalidShares || prior?.invalidShares) {
      changes.uncomparable_rows += (latest?.rows ?? 0) + (prior?.rows ?? 0);
      continue;
    }
    if (!prior) {
      changes.new.push(eventEntry(key, latest, null, 100));
      continue;
    }
    if (!latest) {
      changes.sold.push(eventEntry(key, null, prior, -100));
      continue;
    }
    if (latest.shares === prior.shares) continue;
    const percentage = (latest.shares / prior.shares - 1) * 100;
    if (!Number.isFinite(percentage) || !Number.isFinite(percentage * 100)) {
      changes.uncomparable_rows += latest.rows + prior.rows;
      continue;
    }
    const changePct = Math.round(percentage * 100) / 100;
    changes[latest.shares > prior.shares ? "increased" : "decreased"]
      .push(eventEntry(key, latest, prior, changePct));
  }
  return changes;
}
