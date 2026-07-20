"""Deterministic generator for the frozen CCH-compatible SEC 13F base boundary.

The generator is deliberately a pure-data boundary: acquisition, mutable caches,
publication state, and platform-only enrichment are explicit non-dependencies.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

from input_adapter import InputAdapterError, validate_prepared_investor_data


VERSION = "3.3.3"
EXPECTED_OUTPUT_COUNT = 73
ANALYTIC_NAMES = (
    "buying_pressure.json",
    "consensus.json",
    "conviction.json",
    "conviction_entries.json",
    "enhanced_consensus.json",
    "hhi.json",
    "multi_quarter_trends.json",
    "new_positions.json",
    "options_hedge.json",
    "turnover.json",
)
ROOT = Path(__file__).resolve().parents[2]
PROTECTED_OUTPUT_ROOTS = (
    ROOT / "data" / "sec-13f",
    ROOT / "100xfenok-next" / "public" / "data" / "sec-13f",
)


class GeneratorError(ValueError):
    """Raised when a generation input cannot satisfy the frozen boundary."""


def _canonical_bytes(value: Any) -> bytes:
    # CCH JSON compatibility requires UTF-8, two-space indentation, and no
    # trailing newline. Callers are normalized into deterministic insertion
    # order before serialization so the bytes remain CCH-compatible.
    return json.dumps(
        value,
        ensure_ascii=False,
        indent=2,
        sort_keys=False,
        allow_nan=False,
    ).encode("utf-8")


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _text(value: Any, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise GeneratorError(f"{label} must be a non-empty string")
    return value.strip()


def _quarters(investors: dict[str, Any]) -> list[str]:
    return sorted(
        {filing["quarter"] for investor in investors.values() for filing in investor["filings"]},
        reverse=True,
    )


def _latest_cohort(investors: dict[str, Any], latest_quarter: str) -> dict[str, dict[str, Any]]:
    return {
        investor_id: investor["filings"][-1]
        for investor_id, investor in investors.items()
        if investor["filings"][-1]["quarter"] == latest_quarter
    }


def _ticker_index(cohort: dict[str, dict[str, Any]]) -> dict[str, Any]:
    collected: dict[str, list[dict[str, Any]]] = {}
    for investor_id in sorted(cohort):
        for holding in cohort[investor_id]["holdings"]:
            collected.setdefault(holding["ticker"], []).append(
                {
                    "investor": investor_id,
                    "shares": holding["shares"],
                    "weight": holding["weight"],
                }
            )
    return {
        ticker: {
            "holders": [row["investor"] for row in rows],
            "total_shares": sum(row["shares"] for row in rows),
            "holder_details": rows,
        }
        for ticker, rows in sorted(collected.items())
    }


def _sector_index(cohort: dict[str, dict[str, Any]]) -> dict[str, Any]:
    collected: dict[str, dict[str, Any]] = {}
    source_mix: dict[str, int] = {}
    for investor_id in sorted(cohort):
        for holding in cohort[investor_id]["holdings"]:
            sector = holding["sector"]
            classification_source = holding.get("enrichment_source") or "unknown"
            source_mix[classification_source] = source_mix.get(classification_source, 0) + 1
            data = collected.setdefault(sector, {"investors": set(), "weights": [], "tickers": []})
            data["investors"].add(investor_id)
            data["weights"].append(holding["weight"])
            if holding["ticker"] not in data["tickers"]:
                data["tickers"].append(holding["ticker"])
    output = {
        sector: {
            "investors": sorted(data["investors"]),
            "avg_weight": round(sum(data["weights"]) / len(data["weights"]), 4),
            "top_holdings": data["tickers"][:10],
        }
        for sector, data in sorted(collected.items())
    }
    output["_meta"] = {"source_mix": dict(sorted(source_mix.items()))}
    return output


def _summary(
    investors: dict[str, Any],
    quarters: list[str],
    generated_at: str,
    metadata_extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    latest_quarter = quarters[0]
    investor_summary: dict[str, Any] = {}
    all_tickers: dict[str, dict[str, int | float]] = {}
    for investor_id, investor in investors.items():
        latest = investor["filings"][-1]
        top = sorted(latest["holdings"], key=lambda row: (-row["market_value"], row["ticker"], row["cusip"]))
        investor_summary[investor_id] = {
            "name": investor["name"],
            "group": investor["group"],
            "aum": latest["aum_total"],
            "holdings_count": latest["holdings_count"],
            "top5": [row["ticker"] for row in top[:5]],
            "quarter": latest["quarter"],
            "latest_quarter": latest["quarter"],
            "global_latest_quarter": latest_quarter,
            "is_stale": latest["quarter"] != latest_quarter,
            "stale_quarters": _quarter_lag(latest["quarter"], latest_quarter),
        }
        for holding in latest["holdings"]:
            data = all_tickers.setdefault(holding["ticker"], {"holders": 0, "total_value": 0})
            data["holders"] += 1
            data["total_value"] += holding["market_value"]
    top_stocks = dict(sorted(all_tickers.items(), key=lambda item: (-item[1]["total_value"], item[0]))[:20])
    payload = {
        "metadata": {
            "version": VERSION,
            "generated_at": generated_at,
            "quarters_covered": quarters,
            "investor_count": len(investors),
        },
        "investors": investor_summary,
        "top_stocks": top_stocks,
    }
    if metadata_extra:
        payload["metadata"].update(metadata_extra)
    return payload


def _quarter_lag(value: str, latest: str) -> int:
    def number(quarter: str) -> int:
        year, index = quarter.split("-Q")
        return int(year) * 4 + int(index)

    return max(number(latest) - number(value), 0)


def _positions(filing: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in filing["holdings"]:
        slot = result.setdefault(row["ticker"], {"shares": 0, "market_value": 0, "weight": 0})
        slot["shares"] += row["shares"]
        slot["market_value"] += row["market_value"]
        slot["weight"] = round(slot["weight"] + row["weight"], 4)
    return result


def _analytics(investors: dict[str, Any], quarters: list[str], generated_at: str) -> dict[str, Any]:
    latest_quarter = quarters[0]
    cohort = _latest_cohort(investors, latest_quarter)
    excluded = sorted(set(investors) - set(cohort))
    common_meta = {
        "quarter": latest_quarter,
        "current_cohort_investors": len(cohort),
        "excluded_stale_investors": excluded,
    }
    current = {investor_id: _positions(filing) for investor_id, filing in cohort.items()}
    previous: dict[str, dict[str, dict[str, Any]]] = {}
    for investor_id in cohort:
        filings = investors[investor_id]["filings"]
        previous[investor_id] = _positions(filings[-2]) if len(filings) > 1 else {}

    ticker_holders: dict[str, list[str]] = {}
    for investor_id, positions in current.items():
        for ticker in positions:
            ticker_holders.setdefault(ticker, []).append(investor_id)
    consensus = {
        ticker: {
            "ticker": ticker,
            "score": round(len(set(holders)) / len(cohort), 4) if cohort else 0,
            "holders_count": len(set(holders)),
            "holders_list": sorted(set(holders)),
        }
        for ticker, holders in sorted(ticker_holders.items())
    }

    new_rows: list[dict[str, Any]] = []
    pressure: dict[str, dict[str, Any]] = {}
    turnover: dict[str, dict[str, Any]] = {}
    for investor_id in sorted(cohort):
        current_tickers = set(current[investor_id])
        previous_tickers = set(previous[investor_id])
        for ticker in sorted(current_tickers - previous_tickers):
            position = current[investor_id][ticker]
            new_rows.append(
                {
                    "ticker": ticker,
                    "investor": investor_id,
                    "quarter_added": latest_quarter,
                    "position_value": position["market_value"],
                    "position_weight": position["weight"],
                }
            )
        changed = (current_tickers - previous_tickers) | (previous_tickers - current_tickers)
        denominator = max(len(current_tickers), len(previous_tickers))
        turnover[investor_id] = {
            "investor": investor_id,
            "quarter": latest_quarter,
            "turnover": round(len(changed) / denominator, 4) if denominator else 0,
            "new_count": len(current_tickers - previous_tickers),
            "sold_count": len(previous_tickers - current_tickers),
            "total_positions": len(current_tickers),
        }
    new_rows.sort(key=lambda row: (-row["position_value"], row["investor"], row["ticker"]))
    new_by_ticker: dict[str, list[dict[str, Any]]] = {}
    for row in new_rows:
        new_by_ticker.setdefault(row["ticker"], []).append(row)

    all_tickers = sorted({ticker for values in current.values() for ticker in values} | {ticker for values in previous.values() for ticker in values})
    for ticker in all_tickers:
        buyers = sellers = holders = 0
        value_change = 0
        for investor_id in sorted(cohort):
            current_position = current[investor_id].get(ticker, {"shares": 0, "market_value": 0})
            previous_position = previous[investor_id].get(ticker, {"shares": 0, "market_value": 0})
            delta = current_position["shares"] - previous_position["shares"]
            buyers += int(delta > 0)
            sellers += int(delta < 0)
            holders += int(delta == 0 and current_position["shares"] > 0)
            value_change += delta
        participant_count = buyers + sellers
        pressure[ticker] = {
            "ticker": ticker,
            "net_buyers": buyers,
            "net_sellers": sellers,
            "net_holders": holders,
            "pressure": round((buyers - sellers) / participant_count, 3) if participant_count else 0.0,
            "total_value_change": float(value_change),
        }
    pressure_ranked = sorted(pressure.values(), key=lambda row: (-row["pressure"], row["ticker"]))
    top_buying = [row for row in pressure_ranked[:20] if row["pressure"] > 0]
    top_selling = [row for row in reversed(pressure_ranked[-20:]) if row["pressure"] < 0]

    conviction: dict[str, list[dict[str, Any]]] = {}
    hhi: dict[str, dict[str, Any]] = {}
    option_all: dict[str, dict[str, Any]] = {}
    high_new: list[dict[str, Any]] = []
    conviction_holds: list[dict[str, Any]] = []
    new_pairs = {(row["investor"], row["ticker"]) for row in new_rows}
    for investor_id in sorted(cohort):
        rows = sorted(cohort[investor_id]["holdings"], key=lambda row: -row["market_value"])
        total_value = sum(row["market_value"] for row in rows)
        conviction[investor_id] = [
            {
                "investor": investor_id,
                "ticker": row["ticker"],
                "weight": round(row["market_value"] / total_value, 4) if total_value else 0,
                "rank": rank,
                "is_top5": rank <= 5,
                "is_top10": rank <= 10,
                "market_value": row["market_value"],
            }
            for rank, row in enumerate(rows[:20], start=1)
        ]
        exact_weights = [row["market_value"] / total_value for row in rows] if total_value else []
        hhi_value = round(sum(weight ** 2 for weight in exact_weights), 6)
        top_weight = round(max(exact_weights), 4) if exact_weights else 0
        hhi[investor_id] = {
            "investor": investor_id,
            "hhi": hhi_value,
            "holdings_count": len(rows),
            "top_weight": top_weight,
            "classification": "concentrated" if hhi_value > 0.25 else "moderate" if hhi_value > 0.15 else "diversified",
        }
        puts = [row for row in rows if str(row.get("put_call", "")).upper() == "PUT"]
        calls = [row for row in rows if str(row.get("put_call", "")).upper() == "CALL"]
        equities = [row for row in rows if row not in puts and row not in calls]
        put_value = sum((row["market_value"] for row in puts), 0.0)
        call_value = sum((row["market_value"] for row in calls), 0.0)
        option_all[investor_id] = {
            "investor": investor_id,
            "put_count": len(puts),
            "call_count": len(calls),
            "equity_count": len(equities),
            "put_value": put_value,
            "call_value": call_value,
            "hedge_ratio": round(put_value / (put_value + call_value), 4) if put_value + call_value else 0.0,
        }
        for row in rows:
            exact_weight = row["market_value"] / total_value if total_value else 0
            signal = {
                "investor": investor_id,
                "ticker": row["ticker"],
                "weight": round(exact_weight, 4),
                "value": row["market_value"],
            }
            if (investor_id, row["ticker"]) in new_pairs and exact_weight >= 0.005:
                high_new.append({**signal, "signal": "high_conviction_new" if exact_weight >= 0.02 else "new_entry"})
            elif exact_weight >= 0.05:
                conviction_holds.append({**signal, "signal": "top_conviction_hold"})
    high_new.sort(key=lambda row: (-row["weight"], row["investor"], row["ticker"]))
    conviction_holds.sort(key=lambda row: (-row["weight"], row["investor"], row["ticker"]))

    enhanced: dict[str, dict[str, Any]] = {}
    for ticker in sorted(ticker_holders):
        details = [
            row
            for investor_id in sorted(cohort)
            for row in cohort[investor_id]["holdings"]
            if row["ticker"] == ticker
        ]
        holder_ids = sorted({investor_id for investor_id in cohort if ticker in current[investor_id]})
        equity_classes = {"COM", "SHS", "CL A", "CL B", "CL C", "COM NEW", "ORD SHS", "COM STK"}
        equity_holders = sorted(
            {
                investor_id
                for investor_id in cohort
                if any(
                    row["ticker"] == ticker
                    and str(row.get("title_of_class", "")).upper().strip() in equity_classes
                    and not row.get("put_call")
                    for row in cohort[investor_id]["holdings"]
                )
            }
        )
        enhanced[ticker] = {
            "ticker": ticker,
            "equity_score": round(len(equity_holders) / len(cohort), 4) if cohort else 0,
            "equity_holders": len(equity_holders),
            "total_holders": len(holder_ids),
            "classes_held": sorted({str(row.get("title_of_class")) for row in details if row.get("title_of_class")}),
        }

    trends: dict[str, dict[str, Any]] = {}
    for investor_id in sorted(investors):
        filings = investors[investor_id]["filings"][-8:]
        if len(filings) < 3:
            continue
        trends[investor_id] = {
            "latest_quarter": filings[-1]["quarter"],
            "global_latest_quarter": latest_quarter,
            "is_stale": filings[-1]["quarter"] != latest_quarter,
            "quarterly_snapshots": [
                {
                    "quarter": filing["quarter"],
                    "aum": filing["aum_total"],
                    "holdings_count": filing["holdings_count"],
                    "top_10_weight": filing["top_10_weight"],
                }
                for filing in filings
            ],
            "streaks": _streaks(filings),
        }

    return {
        "analytics/consensus.json": {"metadata": {"total_investors": len(cohort), "tickers_count": len(consensus), **common_meta}, "consensus": consensus},
        "analytics/new_positions.json": {
            "metadata": {"new_positions_count": len(new_rows), "unique_tickers": len(new_by_ticker), **common_meta},
            "new_positions": new_rows,
            "by_ticker": dict(sorted(new_by_ticker.items())),
        },
        "analytics/buying_pressure.json": {
            "metadata": {"tickers_count": len(pressure), **common_meta},
            "buying_pressure": pressure,
            "top_buying": top_buying,
            "top_selling": top_selling,
        },
        "analytics/conviction.json": {
            "metadata": {"quarter": latest_quarter, "investors_count": len(conviction), "generated_at": generated_at, **common_meta},
            "by_investor": conviction,
            "top5_summary": {investor_id: rows[:5] for investor_id, rows in conviction.items()},
        },
        "analytics/hhi.json": {
            "metadata": {
                "investors_count": len(hhi),
                "classifications": {
                    name: sum(1 for row in hhi.values() if row["classification"] == name)
                    for name in ("concentrated", "moderate", "diversified")
                },
                **common_meta,
            },
            "by_investor": dict(sorted(hhi.items(), key=lambda item: (-item[1]["hhi"], item[0]))),
        },
        "analytics/turnover.json": {
            "metadata": {
                "investors_count": len(turnover),
                "avg_turnover": round(sum(row["turnover"] for row in turnover.values()) / len(turnover), 4) if turnover else 0,
                **common_meta,
            },
            "by_investor": dict(sorted(turnover.items(), key=lambda item: (-item[1]["turnover"], item[0]))),
        },
        "analytics/options_hedge.json": {
            "metadata": {"total_investors": len(option_all), "investors_with_options": sum(1 for row in option_all.values() if row["put_count"] or row["call_count"]), **common_meta},
            "by_investor": dict(sorted(((key, row) for key, row in option_all.items() if row["put_count"] or row["call_count"]), key=lambda item: (-item[1]["hedge_ratio"], item[0]))),
            "all_investors": option_all,
        },
        "analytics/enhanced_consensus.json": {"metadata": {"total_investors": len(cohort), "tickers_count": len(enhanced), **common_meta}, "enhanced_consensus": enhanced},
        "analytics/conviction_entries.json": {
            "metadata": {"quarter": latest_quarter, "high_conviction_new_count": len(high_new), "top_conviction_hold_count": len(conviction_holds), **common_meta},
            "high_conviction_new": high_new,
            "top_conviction_hold": conviction_holds,
        },
        "analytics/multi_quarter_trends.json": {
            "metadata": {"investors_count": len(trends), "max_quarters_analyzed": 8, "global_latest_quarter": latest_quarter, "excluded_stale_investors": excluded},
            "by_investor": trends,
        },
    }


def _streaks(filings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(filings) < 4:
        return []
    positions = [(filing["quarter"], _positions(filing)) for filing in filings]
    tickers = sorted({ticker for _, values in positions for ticker in values})
    found: list[dict[str, Any]] = []
    for ticker in tickers:
        directions: list[str] = []
        for (_, previous), (_, current) in zip(positions, positions[1:]):
            before = previous.get(ticker, {}).get("shares", 0)
            after = current.get(ticker, {}).get("shares", 0)
            directions.append("buy" if after > before > 0 else "sell" if 0 < after < before else "hold")
        start = 0
        while start < len(directions):
            end = start + 1
            while end < len(directions) and directions[end] == directions[start]:
                end += 1
            length = end - start
            if directions[start] != "hold" and length >= 3:
                found.append(
                    {
                        "ticker": ticker,
                        "direction": directions[start],
                        "streak_quarters": length,
                        "start_quarter": positions[start + 1][0],
                        "end_quarter": positions[end][0],
                    }
                )
            start = end
    return sorted(
        found,
        key=lambda row: (-row["streak_quarters"], row["ticker"], row["direction"], row["start_quarter"], row["end_quarter"]),
    )[:20]


def _expected_paths(investor_ids: Iterable[str]) -> list[str]:
    paths = ["summary.json", "by_ticker.json", "by_sector.json"]
    paths.extend(f"investors/{investor_id}.json" for investor_id in sorted(investor_ids))
    paths.extend(f"analytics/{name}" for name in ANALYTIC_NAMES)
    return sorted(paths)


def _validate_output_root(output_root: Path) -> Path:
    resolved = Path(output_root).resolve()
    for protected in PROTECTED_OUTPUT_ROOTS:
        protected = protected.resolve()
        if resolved == protected or resolved in protected.parents or protected in resolved.parents:
            raise GeneratorError(f"output_root overlaps protected data tree: {resolved}")
    return resolved


def generate_base_outputs(
    *,
    registry: dict,
    investor_data: dict,
    output_root: Path,
    generated_at: str,
    summary_metadata_extra: dict[str, Any] | None = None,
) -> dict:
    """Generate the exact 73-file base and return a digest-addressable manifest."""

    generated_at = _text(generated_at, label="generated_at")
    output_root = _validate_output_root(Path(output_root))
    if output_root.exists() and not output_root.is_dir():
        raise GeneratorError("output_root must be a directory")
    try:
        investors = validate_prepared_investor_data(registry, investor_data)
    except InputAdapterError as error:
        raise GeneratorError(str(error)) from error
    quarters = _quarters(investors)
    latest_quarter = quarters[0]
    cohort = _latest_cohort(investors, latest_quarter)

    payloads: dict[str, Any] = {
        "summary.json": _summary(investors, quarters, generated_at, summary_metadata_extra),
        "by_ticker.json": _ticker_index(cohort),
        "by_sector.json": _sector_index(cohort),
    }
    metadata = {"version": VERSION, "generated_at": generated_at, "quarters_covered": quarters}
    for investor_id, investor in investors.items():
        payloads[f"investors/{investor_id}.json"] = {"metadata": metadata, "investor": investor}
    payloads.update(_analytics(investors, quarters, generated_at))

    expected_paths = _expected_paths(investors)
    if sorted(payloads) != expected_paths or len(payloads) != EXPECTED_OUTPUT_COUNT:
        raise GeneratorError("generator did not produce the exact 73-output boundary")

    existing_json = {
        path.relative_to(output_root).as_posix()
        for path in output_root.rglob("*.json")
    } if output_root.exists() else set()
    extras = sorted(existing_json - set(expected_paths))
    if extras:
        raise GeneratorError(f"output_root contains undeclared JSON paths: {extras}")

    entries: list[dict[str, Any]] = []
    for relative_path in expected_paths:
        path = output_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = _canonical_bytes(payloads[relative_path])
        path.write_bytes(payload)
        category = "investor" if relative_path.startswith("investors/") else "converter_analytic" if relative_path.startswith("analytics/") else "root_index"
        entries.append(
            {
                "path": relative_path,
                "category": category,
                "bytes": len(payload),
                "sha256": _digest(payload),
            }
        )

    outputs = {
        entry["path"]: {
            "category": entry["category"],
            "bytes": entry["bytes"],
            "sha256": entry["sha256"],
        }
        for entry in entries
    }
    manifest: dict[str, Any] = {
        "schema_version": "sec13f-base-generation/v1",
        "generator_sha256": _digest(Path(__file__).read_bytes()),
        "investor_data_digest": _digest(_canonical_bytes(investors)),
        "generated_at": generated_at,
        "logical_root": ".",
        "investor_count": len(investors),
        "output_count": len(entries),
        "quarters_covered": quarters,
        "entries": entries,
        "entries_digest": _digest(_canonical_bytes(entries)),
        "outputs": outputs,
    }
    manifest["manifest_digest"] = _digest(_canonical_bytes(manifest))
    return manifest
