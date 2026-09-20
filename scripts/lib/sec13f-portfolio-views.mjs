const round4 = (value) => Math.round(value * 10000) / 10000;

export function aggregateFilingHoldings(filing) {
  const aggregate = {
    positions: new Map(),
    reportedValue: 0,
    mappedValue: 0,
    unmappedValue: 0,
    unmappedRows: 0,
  };
  for (const holding of filing?.holdings ?? []) {
    const value = Number(holding?.market_value);
    if (!(value > 0)) continue;
    aggregate.reportedValue += value;
    const ticker = String(holding?.ticker ?? "").trim().toUpperCase();
    if (!ticker) {
      aggregate.unmappedValue += value;
      aggregate.unmappedRows += 1;
      continue;
    }
    aggregate.mappedValue += value;
    const current = aggregate.positions.get(ticker) ?? { value: 0, name: holding.name, gics: null };
    current.value += value;
    if (!current.gics && holding.sector) current.gics = holding.sector;
    aggregate.positions.set(ticker, current);
  }
  return aggregate;
}

export function mergePortfolioAggregates(target, source) {
  target.reportedValue += source.reportedValue;
  target.mappedValue += source.mappedValue;
  target.unmappedValue += source.unmappedValue;
  target.unmappedRows += source.unmappedRows;
  for (const [ticker, holding] of source.positions) {
    const current = target.positions.get(ticker) ?? { value: 0, name: holding.name, gics: null };
    current.value += holding.value;
    if (!current.gics && holding.gics) current.gics = holding.gics;
    target.positions.set(ticker, current);
  }
  return target;
}

export function portfolioCoverage(aggregate) {
  return {
    reported_value: Math.round(aggregate.reportedValue),
    mapped_value: Math.round(aggregate.mappedValue),
    unmapped_value: Math.round(aggregate.unmappedValue),
    mapped_ratio: aggregate.reportedValue > 0 ? round4(aggregate.mappedValue / aggregate.reportedValue) : 0,
    unmapped_rows: aggregate.unmappedRows,
  };
}

export function sectorWeights(aggregate, { resolveSector, canonical }) {
  const bySector = Object.fromEntries(canonical.map((sector) => [sector, 0]));
  if (!(aggregate.reportedValue > 0)) return bySector;
  for (const [ticker, holding] of aggregate.positions) {
    const sector = resolveSector(holding.gics, ticker, holding.name);
    bySector[sector] = (bySector[sector] ?? 0) + holding.value / aggregate.reportedValue;
  }
  if (aggregate.unmappedValue > 0) {
    bySector.Other = (bySector.Other ?? 0) + aggregate.unmappedValue / aggregate.reportedValue;
  }
  for (const sector of Object.keys(bySector)) bySector[sector] = round4(bySector[sector]);
  return bySector;
}

export function treemapRows(aggregate, topN, reportDate, { resolveSector, returnForTicker }) {
  if (!(aggregate.reportedValue > 0)) return [];
  const rows = [...aggregate.positions.entries()]
    .map(([ticker, holding]) => ({
      ticker,
      name: holding.name,
      sector: resolveSector(holding.gics, ticker, holding.name),
      weight: round4(holding.value / aggregate.reportedValue),
      value: Math.round(holding.value),
      ret: returnForTicker(ticker, reportDate),
    }))
    .sort((a, b) => b.weight - a.weight);
  const top = rows.slice(0, topN);
  const rest = rows.slice(topN);
  if (rest.length > 0) {
    top.push({
      ticker: "_OTHERS",
      name: `기타 ${rest.length}종목`,
      sector: "Other",
      weight: round4(rest.reduce((sum, row) => sum + row.value, 0) / aggregate.reportedValue),
      value: rest.reduce((sum, row) => sum + row.value, 0),
      ret: null,
    });
  }
  if (aggregate.unmappedValue > 0) {
    top.push({
      ticker: "_UNMAPPED",
      name: `티커 미매핑 ${aggregate.unmappedRows}건`,
      sector: "Other",
      weight: round4(aggregate.unmappedValue / aggregate.reportedValue),
      value: Math.round(aggregate.unmappedValue),
      ret: null,
    });
  }
  return top;
}
