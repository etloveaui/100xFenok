#!/usr/bin/env python3
"""Bounded per-ticker state for the Yahoo quote/history acquisition lane."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path


SYMBOL_RE = re.compile(r"^(?:[A-Z0-9][A-Z0-9.\-]{0,11}|\^(?:KS11|KQ11))$")
NEW_LISTING_PENDING_DAYS = 31
ERROR_TEXT_LIMIT = 1000
ACTIVE_UNIVERSE_SCHEMA_VERSION = "yahoo-batch-active-universe/v1"
CORE_ETF_INDEX_FILENAME = "index-core-etf.json"
DEFAULT_INDEX_FILENAME = "index.json"
TERMINAL_RESOLUTION_STATE = "terminal_provider_unsupported"
# Maximum refused share and minimum allowance for a completed, evidenced run.
# Lead set 2026-10-11: 0.5%, floor 3; (0.0, 0) restores fail-on-any-refusal.
YAHOO_RUN_REFUSAL_BUDGET = (0.005, 3)
AUTO_TERMINAL_ATTEMPTS = 3
AUTO_TERMINAL_HISTORY_BUSINESS_DAYS = 10
TERMINAL_PROBE_DAYS = 7
TERMINAL_PROBES_PER_RUN = 4


# Verified same-security ticker changes. Select the current security as a new
# canonical ticker; never splice its prices into the retired symbol's history.
# Issuer notices: SEC 2026-08-17 (EQR), BNY 2026-05-11, EchoStar 2026-06-22,
# Marsh 2026-01-14, Corgi SEC 497(e) 2026-08-19, Invesco SEC 497k 2023-06-06.
YAHOO_SAME_SECURITY_SUCCESSORS = {
    "EQR": "VMRK", "BK": "BNY", "SATS": "ECHO", "MMC": "MRSH",
    "MGKX": "MEGX", "VBX": "USSX", "VOOX": "USLX",
    "XVO": "USMX", "XVUG": "USGX", "EWCO": "RSPC", "IHYF": "GTOQ",
    "PSKY": "SKYD", "MAPP": "MATR",
}
YAHOO_SAME_SECURITY_EFFECTIVE = {
    "EQR": "2026-08-18", "BK": "2026-05-21", "SATS": "2026-06-24",
    "MMC": "2026-01-14", "MGKX": "2026-08-21", "VBX": "2026-08-21",
    "VOOX": "2026-08-21", "XVO": "2026-08-21", "XVUG": "2026-08-21",
    "EWCO": "2023-06-07",
    # Conservative routing cutoff: this dated SEC prospectus confirms the
    # completed rename. This is not a claim about the first GTOQ trading day.
    "IHYF": "2026-02-27",
    "PSKY": "2026-10-06", "MAPP": "2026-08-31",
}
# Public securities ended; merger consideration is not a ticker alias.
# AVB: 2.793 VMRK shares; CTRA: 0.70 DVN shares. EA was taken private.
YAHOO_ENDED_SECURITIES = {
    **{symbol: "WEBs SEC liquidation supplement; trading halted after 2026-08-26"
       for symbol in ("DVIN", "DVRE", "DVUT", "DVXB", "DVXC", "DVXE", "DVXF", "DVXK", "DVXP", "DVXV", "DVXY")},
    "USML": "UBS redemption settled 2026-08-19",
    "QRVO": "Skyworks merger closed 2026-10-05; cash and 0.960 SWKS shares per QRVO share",
    "WBD": "Skydance cash acquisition closed 2026-10-06; WBD shares ceased trading",
    "CUSD": "SEC liquidation supplement; trading ceased after 2026-06-26",
    "BLD": "SEC closing 8-K; trading suspended before 2026-07-01 open",
    "DAY": "Thoma Bravo cash acquisition closed 2026-02-04; shares ceased trading",
    "HOLX": "SEC closing 8-K; taken private 2026-04-07",
    "AVB": "SEC closing 8-K 2026-08-17; 2.793 VMRK shares per AVB share",
    "EA": "SEC closing 8-K 2026-08-04; public shares cancelled",
    "CTRA": "SEC closing 8-K 2026-05-07; 0.70 DVN shares per CTRA share",
    "IWDL": "UBS redemption settled 2026-08-19",
    "IWFL": "UBS redemption settled 2026-08-19",
    "IWML": "UBS redemption settled 2026-08-19",
    "MTUL": "UBS redemption settled 2026-08-19",
    "QULL": "UBS redemption settled 2026-08-19",
    "SCDL": "UBS redemption settled 2026-08-19",
    "DEFI": "Hashdex closure; last trading day 2026-08-17",
    "012510.KS": "KRX final share exchange notice; delisted 2026-07-15",
    "230360.KQ": "KRX final cash share exchange notice; delisted 2026-06-30",
}
YAHOO_SECURITY_END_DATES = {
    **{symbol: "2026-08-27" for symbol in
       ("DVIN", "DVRE", "DVUT", "DVXB", "DVXC", "DVXE", "DVXF", "DVXK", "DVXP", "DVXV", "DVXY")},
    "USML": "2026-08-19", "QRVO": "2026-10-05", "WBD": "2026-10-06",
    "CUSD": "2026-06-27", "BLD": "2026-07-01", "DAY": "2026-02-04", "HOLX": "2026-04-07",
    "AVB": "2026-08-17", "EA": "2026-08-05", "CTRA": "2026-05-07",
    "IWDL": "2026-08-19", "IWFL": "2026-08-19", "IWML": "2026-08-19",
    "MTUL": "2026-08-19", "QULL": "2026-08-19", "SCDL": "2026-08-19",
    "DEFI": "2026-08-18",
    "012510.KS": "2026-07-15", "230360.KQ": "2026-06-30",
}
YAHOO_LIFECYCLE_SOURCES = {
    "MAPP": "https://www.sec.gov/Archives/edgar/data/1860434/000119312526353573/d180613d497.htm",
    **{symbol: "https://www.sec.gov/Archives/edgar/data/1580843/000121390026090266/ea0302118-01_497.htm"
       for symbol in ("DVIN", "DVRE", "DVUT", "DVXB", "DVXC", "DVXE", "DVXF", "DVXK", "DVXP", "DVXV", "DVXY")},
    "USML": "https://etracs.ubs.com/news/show-article/id/724",
    "QRVO": "https://www.qorvo.com/about/news-events/news-releases/2026/skyworks-completes-combination-with-qorvo",
    "WBD": "https://www.sec.gov/Archives/edgar/data/2041610/000110465926113913/tm2626659d7_ex99-1.htm",
    "PSKY": "https://www.sec.gov/Archives/edgar/data/2041610/000110465926113913/tm2626659d7_ex99-1.htm",
    "CUSD": "https://www.sec.gov/Archives/edgar/data/1141819/000089418926019839/cusd497eliquidation.htm",
    "BLD": "https://www.sec.gov/Archives/edgar/data/1633931/000110465926079876/tm2618991d10_8k.htm",
    "DAY": "https://www.thomabravo.com/press-releases/thoma-bravo-completes-acquisition-of-dayforce",
    "HOLX": "https://www.sec.gov/Archives/edgar/data/859737/000119312526144632/d135035d8k.htm",
    "EQR": "https://www.sec.gov/Archives/edgar/data/915912/000110465926097833/tm2623381d1_8k.htm",
    "BK": "https://www.bny.com/corporate/global/en/about-us/newsroom/press-release/bny-announces-planned-change-of-stock-ticker-symbol-to-bny-130465.html",
    "SATS": "https://ir.echostar.com/news-releases/news-release-details/echostar-changing-stocker-ticker-sats-echo-marking-companys-next",
    "MMC": "https://www.sec.gov/Archives/edgar/data/62709/000006270926000022/mrsh-20251231.htm",
    "MGKX": "https://www.sec.gov/Archives/edgar/data/2078265/000207826526000347/497e_ticker_changes.htm",
    "VBX": "https://www.sec.gov/Archives/edgar/data/2078265/000207826526000347/497e_ticker_changes.htm",
    "VOOX": "https://www.sec.gov/Archives/edgar/data/2078265/000207826526000347/497e_ticker_changes.htm",
    "XVO": "https://www.sec.gov/Archives/edgar/data/2078265/000207826526000347/497e_ticker_changes.htm",
    "XVUG": "https://www.sec.gov/Archives/edgar/data/2078265/000207826526000347/497e_ticker_changes.htm",
    "EWCO": "https://www.sec.gov/Archives/edgar/data/1209466/000119312523147120/d428859d497k.htm",
    "IHYF": "https://www.sec.gov/Archives/edgar/data/1418144/000119312526079070/d106358d497k.htm",
    "AVB": "https://www.sec.gov/Archives/edgar/data/915912/000110465926097833/tm2623381d1_8k.htm",
    "EA": "https://www.sec.gov/Archives/edgar/data/712515/000114036126031157/ef20079099_8k.htm",
    "CTRA": "https://www.sec.gov/Archives/edgar/data/858470/000110465926057278/tm2613882d1_8k.htm",
    "IWDL": "https://etracs.ubs.com/news/show-article/id/727",
    "IWFL": "https://etracs.ubs.com/news/show-article/id/727",
    "IWML": "https://etracs.ubs.com/news/show-article/id/727",
    "MTUL": "https://etracs.ubs.com/news/show-article/id/727",
    "QULL": "https://etracs.ubs.com/news/show-article/id/727",
    "SCDL": "https://etracs.ubs.com/news/show-article/id/727",
    "DEFI": "https://www.sec.gov/Archives/edgar/data/1985840/000121390026084293/ea030017001ex99-1.htm",
    "012510.KS": "https://kind.krx.co.kr/external/2026/07/08/000166/20260708000253/68051.htm",
    "230360.KQ": "https://kind.krx.co.kr/external/2026/06/25/000847/20260625002043/70769.htm",
}
YAHOO_RETIRED_SYMBOLS = frozenset(YAHOO_SAME_SECURITY_SUCCESSORS) | frozenset(YAHOO_ENDED_SECURITIES)


def retired_yahoo_symbols(as_of):
    day = str(as_of)[:10]
    return {
        ticker for ticker, effective in {
            **YAHOO_SAME_SECURITY_EFFECTIVE, **YAHOO_SECURITY_END_DATES,
        }.items() if day >= effective
    }


def current_yahoo_universe_sources(sources, as_of):
    """Route scheduled selection to live identifiers while retaining provenance."""
    current = {}
    retired = retired_yahoo_symbols(as_of)
    for ticker, discovered_from in sources.items():
        if ticker in YAHOO_ENDED_SECURITIES and ticker in retired:
            continue
        selected = YAHOO_SAME_SECURITY_SUCCESSORS.get(ticker, ticker) if ticker in retired else ticker
        labels = current.setdefault(selected, set())
        labels.update(discovered_from)
        if selected != ticker:
            labels.add(f"same_security_successor:{ticker}")
    return {ticker: sorted(labels) for ticker, labels in current.items()}


def verified_yahoo_terminal_evidence(as_of):
    """Lifecycle policy carried by this revision, not a synthetic run artifact."""
    evidence = {
        ticker: [{"symbol": ticker, "terminal": True, "alias_target": None,
                  "reason": reason, "source": "verified_public_lifecycle",
                  "source_url": YAHOO_LIFECYCLE_SOURCES[ticker],
                  "effective_date": YAHOO_SECURITY_END_DATES[ticker]}]
        for ticker, reason in YAHOO_ENDED_SECURITIES.items()
    }
    evidence.update({
        ticker: [{"symbol": ticker, "terminal": True, "alias_target": successor,
                  "reason": "same public security now trades under successor ticker",
                  "source": "verified_public_lifecycle",
                  "source_url": YAHOO_LIFECYCLE_SOURCES[ticker],
                  "effective_date": YAHOO_SAME_SECURITY_EFFECTIVE[ticker]}]
        for ticker, successor in YAHOO_SAME_SECURITY_SUCCESSORS.items()
    })
    retired = retired_yahoo_symbols(as_of)
    return {"artifact_path": None, "artifact_sha256": None,
            "artifact_generated_at": None,
            "tickers": {ticker: rows for ticker, rows in evidence.items() if ticker in retired}}


@lru_cache(maxsize=512)
def _calendar_age(source: str, observed_hour: str, market_ticker: str) -> dict:
    result = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import {yahooBusinessDayAge} from './scripts/lib/market-calendar.mjs';"
         "import {YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS as limit} from './scripts/lib/kpi-contract-constants.mjs';"
         "console.log(JSON.stringify({age:yahooBusinessDayAge(...JSON.parse(process.argv[1])),limit}));",
         json.dumps([source, observed_hour, market_ticker])],
        cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def source_business_day_policy(ticker: str, source: str | None, observed_at: str) -> dict:
    if _iso_ms(source) is None or _iso_ms(observed_at) is None:
        return {"age": None, "limit": None}
    # Reuse the existing US/KRX/conservative-foreign calendar, with one cached
    # calculation per source and observation hour rather than per member.
    market = "005930.KS" if re.search(r"\.(KS|KQ)$", ticker) else (
        "AAPL" if "." not in ticker or re.fullmatch(r"[A-Z]+\.[A-Z]", ticker) else "UNKNOWN.DE")
    observed = datetime.fromtimestamp(_iso_ms(observed_at) / 1000, timezone.utc)
    hour = observed.replace(minute=0, second=0, microsecond=0).isoformat()
    return _calendar_age(source, hour, market)


def source_business_day_age(ticker: str, source: str | None, observed_at: str) -> int | None:
    return source_business_day_policy(ticker, source, observed_at)["age"]


def yahoo_run_verdict(*, current_results, errors, retry_symbols, assessments,
                      expected_shards=1, attempted_shards=1, completed_shards=1,
                      shard_exit_codes=(), reported_failed=None):
    """Assess the invocation without changing any per-member refusal or source date."""
    attempted = current_results.get("attempted", 0)
    failed = current_results.get("failed", 0)
    budget = max(YAHOO_RUN_REFUSAL_BUDGET[1], int(attempted * YAHOO_RUN_REFUSAL_BUDGET[0]))
    reasons = []
    if attempted_shards != expected_shards or completed_shards != expected_shards:
        reasons.append("scheduled shards were unattempted or incomplete")
    if any(code >= 2 for code in shard_exit_codes):
        reasons.append("a shard reported a systemic failure")
    if (reported_failed is not None and reported_failed != failed) or (failed == 0 and 1 in shard_exit_codes):
        reasons.append("process and summary refusal counts disagree")
    refused = {row.get("ticker") for row in errors if isinstance(row, dict) and row.get("ticker")}
    named = {row.get("ticker") for row in current_results.get("errors", [])
             if isinstance(row, dict) and row.get("ticker")}
    if failed != len(refused) or failed != len(errors) or named != refused or failed > attempted:
        reasons.append("refused members are missing or inconsistent in KPI evidence")
    retained, deferred, assessed = set(), set(), set()
    for assessment in assessments:
        if not isinstance(assessment, dict):
            continue
        retained.update(assessment.get("retained_lkg_tickers") or [])
        deferred.update(assessment.get("deferred_without_lkg_tickers") or [])
        assessed.update(assessment.get("tickers") or [])
        if assessment.get("reasons") or assessment.get("exit_code", 0) >= 2:
            reasons.append("per-member preservation or failure evidence is invalid")
    if failed and (not refused.issubset(retained | deferred) or assessed != refused):
        reasons.append("a refused member has neither verified retained data nor named deferral")
    if not refused.issubset(set(retry_symbols)):
        reasons.append("a refused member is absent from the retry set")
    # The budget guards members Yahoo has served before. A named deferral without
    # prior data (a new listing Yahoo does not serve yet) stays refused, counted
    # and in the retry set, but does not spend that budget.
    if len(refused - deferred) > budget:
        reasons.append("refusals exceed the run budget")
    return {"verdict": "failed" if reasons else "degraded" if failed else "complete",
            "exit_code": 1 if reasons else 0, "attempted": attempted, "refused": failed,
            "refusal_budget": budget, "reasons": reasons}


def _json_bytes(payload: dict) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _read_json(path: Path) -> dict | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        tmp.write_bytes(_json_bytes(payload))
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink()


def _write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    try:
        tmp.write_bytes(payload)
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink()


def _bounded_error(value) -> str:
    return str(value or "unknown error")[:ERROR_TEXT_LIMIT]


def _iso_ms(value) -> float | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp() * 1000


def _is_recent_listing(payload: dict, observed_at: str) -> bool:
    first_trade_ms = _iso_ms(payload.get("first_trade_date"))
    observed_ms = _iso_ms(observed_at)
    if first_trade_ms is None or observed_ms is None or first_trade_ms > observed_ms:
        return False
    return observed_ms - first_trade_ms <= NEW_LISTING_PENDING_DAYS * 86400000


def _pending_history_reason(payload: dict, state: dict, observed_at: str) -> str | None:
    if _is_recent_listing(payload, observed_at):
        return "recent_listing"
    pending = state.get("pending") if isinstance(state.get("pending"), dict) else {}
    first_seen_ms = _iso_ms(pending.get("first_seen_at"))
    observed_ms = _iso_ms(observed_at)
    if first_seen_ms is not None and observed_ms is not None:
        return "newly_discovered_no_history" if 0 <= observed_ms - first_seen_ms <= NEW_LISTING_PENDING_DAYS * 86400000 else None
    return "newly_discovered_no_history" if not isinstance(state.get("last_result"), dict) else None


def _epoch_iso(value) -> str | None:
    try:
        seconds = float(value)
        if seconds > 10_000_000_000:
            seconds /= 1000
        return datetime.fromtimestamp(seconds, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError, OverflowError, OSError):
        return None






def _contains_provider_value(candidate, provider) -> bool:
    if provider is None:
        return True
    if isinstance(provider, dict):
        return isinstance(candidate, dict) and all(
            key in candidate and _contains_provider_value(candidate[key], value)
            for key, value in provider.items()
            if value is not None
        )
    if isinstance(provider, list):
        return isinstance(candidate, list) and all(item in candidate for item in provider)
    return candidate == provider


def _raw_payload_source_fields(payload: dict) -> dict:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    info = data.get("info") if isinstance(data.get("info"), dict) else {}
    quote = _epoch_iso(info.get("regularMarketTime"))
    history = data.get("history_1y") if isinstance(data.get("history_1y"), list) else []
    dates = sorted({
        str(row.get("date"))[:10]
        for row in history
        if isinstance(row, dict) and _iso_ms(str(row.get("date") or "")[:10]) is not None
    })
    history_as_of = dates[-1] if dates else None
    source_as_of = (
        history_as_of if history_as_of and (not quote or history_as_of <= quote[:10]) else quote
    )
    return {"quote_as_of": quote, "history_as_of": history_as_of, "source_as_of": source_as_of}


def valid_illiquid_history(payload: dict) -> bool:
    provenance = payload.get("provenance") or {}
    if not isinstance(provenance, dict) or provenance.get("quote_clock") != "stale_illiquid":
        return False
    source = _raw_payload_source_fields(payload)
    prior = provenance.get("previous_history_as_of")
    history = source["history_as_of"]
    quote = source["quote_as_of"]
    info = (payload.get("data") or {}).get("info") or {}
    if (info.get("quoteType") != "ETF" or not history or not quote or not prior
            or _iso_ms(prior) is None or history <= prior
            or provenance.get("freshness_basis") != "history_as_of"
            or provenance.get("quote_as_of") != quote or provenance.get("history_as_of") != history):
        return False
    policy = source_business_day_policy(payload.get("ticker", ""), history, payload.get("fetched_at"))
    quote_age = source_business_day_age(payload.get("ticker", ""), quote, payload.get("fetched_at"))
    return (isinstance(policy["age"], int) and policy["age"] <= policy["limit"]
            and isinstance(quote_age, int) and quote_age > policy["limit"])


def _derived_payload_source_fields(payload: dict) -> dict:
    source = _raw_payload_source_fields(payload)
    if valid_illiquid_history(payload):
        source["source_as_of"] = source["history_as_of"]
    return source


def _payload_source_fields(payload: dict) -> dict:
    return _derived_payload_source_fields(payload)


def _valid_canonical_payload(payload: dict | None, ticker: str) -> bool:
    if not isinstance(payload, dict):
        return False
    if payload.get("schema_version") != "yf-finance/v2" or payload.get("ticker") != ticker:
        return False
    fetched_ms = _iso_ms(payload.get("fetched_at"))
    if fetched_ms is None:
        return False
    data = payload.get("data")
    if not isinstance(data, dict) or not any(value is not None for value in data.values()):
        return False
    source = _derived_payload_source_fields(payload)
    if any(
        key in payload and payload.get(key) != source.get(key)
        for key in ("quote_as_of", "history_as_of", "source_as_of")
    ):
        return False
    quote_ms = _iso_ms(source["quote_as_of"])
    history_ms = _iso_ms(source["history_as_of"])
    source_ms = _iso_ms(source["source_as_of"])
    if quote_ms is None and history_ms is None:
        return False
    if source_ms is None or (quote_ms is not None and quote_ms > fetched_ms):
        return False
    if history_ms is not None and history_ms > fetched_ms + 14 * 3600000:
        return False
    return True


def _result(run: dict, outcome: str, evidence: dict, *, error: str | None = None) -> dict:
    row = {
        "observed_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
        "outcome": outcome,
        "attempts_used": int(evidence["attempts_used"]) if evidence.get("attempts_used") is not None else 1,
        "latency_ms": int(evidence.get("latency_ms") or 0),
        "failures": [{**item, "error": _bounded_error(item.get("error"))}
                     for item in list(evidence.get("failures") or [])[:6] if isinstance(item, dict)],
    }
    if error:
        row["error"] = _bounded_error(error)
    return row


def source_freshness_contract(source_by_ticker, now_iso):
    """Evaluate Yahoo source ages and the canonical bound through the JS contract SSOT."""
    script = """
import { yahooBusinessDayAge } from './scripts/lib/market-calendar.mjs';
import { YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS } from './scripts/lib/kpi-contract-constants.mjs';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const ages = Object.fromEntries(Object.entries(input.sources).map(([ticker, source]) => [
  ticker,
  yahooBusinessDayAge(source, input.now, ticker),
]));
process.stdout.write(JSON.stringify({ ages, max_source_business_days: YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS }));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=Path(__file__).resolve().parent.parent,
        input=json.dumps({"sources": source_by_ticker, "now": now_iso}),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Yahoo source-age classification failed: {result.stderr.strip()[:500]}")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Yahoo source-age classifier returned invalid JSON") from exc
    ages = payload.get("ages") if isinstance(payload.get("ages"), dict) else None
    bound = payload.get("max_source_business_days")
    if ages is None or not isinstance(bound, int):
        raise RuntimeError("Yahoo source-age classifier returned an invalid contract shape")
    return {"ages": ages, "max_source_business_days": bound}


class YahooBatchStateStore:
    """Derive retained-good payloads from the active generation; retain actual observations."""

    def __init__(self, root: Path, finance_dir: Path):
        self.root = Path(root)
        self.finance_dir = Path(finance_dir)
        self.ticker_dir = self.root / "tickers"
        self.lkg_dir = (Path(os.environ["YF_ACTIVE_GENERATION_ROOT"]) / "finance"
                        if os.environ.get("YF_ACTIVE_GENERATION_ROOT") else self.finance_dir)
        self.active_universe_path = self.root / "active-universe.json"
        self._results: dict[str, dict] = {}

    def _state_path(self, ticker: str) -> Path:
        return self.ticker_dir / f"{ticker}.json"

    def _lkg_path(self, ticker: str) -> Path:
        return self.lkg_dir / f"{ticker}.json"

    def _load_state(self, ticker: str) -> dict:
        state = _read_json(self._state_path(ticker)) or {
            "schema_version": "yahoo-batch-quote-history-state/v1", "ticker": ticker,
        }
        legacy_result = state.pop("last_attempt", None)
        if "last_result" not in state and isinstance(legacy_result, dict):
            state["last_result"] = legacy_result
        for key in ("attempts", "provider_observation", "promotion_contract", "latest_promotion_deferral",
                    "recovered_from_run_id", "recovery_run_id", "recovery_run_attempt", "recovery_event_name", "last_recovered_failure"):
            state.pop(key, None)
        for key in ("last_result", "latest_failure", "pending", "terminal", "stale"):
            if isinstance(state.get(key), dict):
                state[key] = {k: v for k, v in state[key].items()
                              if k not in {"run_id", "run_attempt", "event_name", "natural", "schedule", "shard",
                                           "initial_run_id", "classified_run_id"}}
        return state

    def _load_active_universe(self) -> dict:
        payload = _read_json(self.active_universe_path)
        if (
            isinstance(payload, dict)
            and payload.get("schema_version") == ACTIVE_UNIVERSE_SCHEMA_VERSION
            and isinstance(payload.get("items"), dict)
        ):
            for item in payload["items"].values():
                if isinstance(item, dict):
                    item.pop("first_seen_run_id", None)
                    item.pop("last_seen_run_id", None)
            return payload
        return {"schema_version": ACTIVE_UNIVERSE_SCHEMA_VERSION, "items": {}}

    @staticmethod
    def _is_pending_acquisition(item: object) -> bool:
        return (
            isinstance(item, dict)
            and item.get("resolution_state") == "pending_acquisition"
            and item.get("coverage") is False
            and item.get("coverage_status") == "not_observed"
            and item.get("provider_reachability") == "not_attempted"
        )

    def _remove_pending_after_state(self, ticker: str) -> None:
        """Drop an inventory duplicate only after its per-ticker state is durable.

        A crash between these writes leaves a harmless duplicate; state-first index
        precedence keeps it out of pending counts until the next reconciliation.
        """
        inventory = self._load_active_universe()
        items = inventory["items"]
        if ticker not in items:
            return
        del items[ticker]
        inventory["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        _write_json(self.active_universe_path, inventory)

    def reconcile_active_universe(
        self,
        active_universe: set[str],
        sources: dict[str, list[str]],
        run: dict,
    ) -> int:
        """Persist only active symbols that have never received a Yahoo observation."""
        inventory = self._load_active_universe()
        items = inventory["items"]
        observed_at = str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        changed = 0
        for ticker in sorted(set(active_universe)):
            # Per-ticker observation/terminal state always wins over stale inventory.
            if _read_json(self._state_path(ticker)) is not None:
                if ticker in items:
                    del items[ticker]
                    changed += 1
                continue
            existing = items.get(ticker)
            discovered_from = sorted(set(sources.get(ticker, [])))
            if self._is_pending_acquisition(existing):
                prior_sources = existing.get("discovered_from") if isinstance(existing.get("discovered_from"), list) else []
                if not isinstance(existing.get("first_seen_from"), list):
                    existing["first_seen_from"] = sorted(set(prior_sources))
                    changed += 1
                merged_sources = sorted({*prior_sources, *discovered_from})
                if existing.get("discovered_from") != merged_sources:
                    existing["discovered_from"] = merged_sources
                    changed += 1
                if existing.get("last_seen_at") != observed_at:
                    existing["last_seen_at"] = observed_at
                    changed += 1
                continue
            items[ticker] = {
                "resolution_state": "pending_acquisition",
                "coverage": False,
                "coverage_status": "not_observed",
                "provider_reachability": "not_attempted",
                "discovered_from": discovered_from,
                "first_seen_from": discovered_from,
                "first_seen_at": observed_at,
                "last_seen_at": observed_at,
            }
            changed += 1
        if changed or not self.active_universe_path.exists():
            inventory["generated_at"] = observed_at
            _write_json(self.active_universe_path, inventory)
        return changed

    def pending_acquisition_tickers(self, active_universe: set[str]) -> set[str]:
        items = self._load_active_universe()["items"]
        return {
            ticker for ticker in set(active_universe)
            if _read_json(self._state_path(ticker)) is None and self._is_pending_acquisition(items.get(ticker))
        }

    def prospective_pending_acquisition_tickers(self, active_universe: set[str]) -> set[str]:
        """Resolve a first-run campaign without persisting its pending inventory."""
        return {
            ticker for ticker in set(active_universe)
            if _read_json(self._state_path(ticker)) is None
        }

    def load_terminal_evidence(self, artifact_path: Path) -> dict:
        path = Path(artifact_path)
        try:
            payload_bytes = path.read_bytes()
            payload = json.loads(payload_bytes)
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"terminal evidence artifact is unreadable: {path}") from exc
        if (
            not isinstance(payload, dict)
            or payload.get("schema_version") != "fenok-s1-stock-public-promotion-dry-run/v0.1"
            or payload.get("dry_run") is not True
            or _iso_ms(payload.get("generated_at")) is None
            or not isinstance(payload.get("blocked_rows"), list)
        ):
            raise ValueError("terminal evidence artifact contract is invalid")
        tickers = {}
        for row in payload["blocked_rows"]:
            ticker = str(row.get("ticker") or "").strip().upper() if isinstance(row, dict) else ""
            policy = row.get("corporate_action_policy") if isinstance(row, dict) else None
            evidence = policy.get("evidence") if isinstance(policy, dict) else None
            if not ticker or not isinstance(evidence, list):
                continue
            terminal_rows = [
                item for item in evidence
                if isinstance(item, dict)
                and item.get("terminal") is True
                and str(item.get("symbol") or "").upper() == ticker
                and item.get("alias_target") is None
            ]
            if terminal_rows:
                tickers[ticker] = terminal_rows
        try:
            artifact_label = path.relative_to(self.root.parents[1]).as_posix()
        except ValueError:
            artifact_label = path.name
        return {
            "artifact_path": artifact_label,
            "artifact_sha256": _sha256(payload_bytes),
            "artifact_generated_at": payload["generated_at"],
            "tickers": tickers,
        }

    def transition_terminal_tickers(self, active_universe: set[str], terminal_evidence: dict, run: dict) -> int:
        if not isinstance(terminal_evidence, dict) or not isinstance(terminal_evidence.get("tickers"), dict):
            raise ValueError("terminal evidence contract is invalid")
        transitioned = 0
        for ticker in sorted(set(active_universe) & set(terminal_evidence["tickers"])):
            state = self._load_state(ticker)
            state.update({
                "schema_version": "yahoo-batch-quote-history-state/v1",
                "ticker": ticker,
                "resolution_state": TERMINAL_RESOLUTION_STATE,
                "retry": False,
                "terminal": {
                    "artifact_path": terminal_evidence.get("artifact_path"),
                    "evidence_sha256": terminal_evidence.get("artifact_sha256"),
                    "artifact_generated_at": terminal_evidence.get("artifact_generated_at"),
                    "evidence": terminal_evidence["tickers"][ticker],
                    "classified_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
                },
                "updated_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
            })
            state.pop("pending", None)
            state.pop("stale", None)
            _write_json(self._state_path(ticker), state)
            self._remove_pending_after_state(ticker)
            transitioned += 1
        return transitioned

    def _record_result(self, state: dict, row: dict) -> None:
        self._results[state["ticker"]] = dict(row)

    def retained_stockanalysis_etf_sources(
        self,
        excluded_tickers: set[str] | None = None,
        etf_universe_path: Path | None = None,
        *, include_terminal: bool = False,
    ) -> dict[str, list[str]]:
        """Join current typed ETFs to the Yahoo catalogue for schedule membership.

        This grants acquisition schedule membership only; it does not bless an
        existing canonical payload. Terminal and retired exclusions remain
        caller-owned, while the current typed source and Yahoo catalogue bound
        the eligible population.
        """
        catalogue_index = _read_json(self.root / DEFAULT_INDEX_FILENAME)
        catalogue_symbols = catalogue_index.get("catalogue_symbols") if catalogue_index else None
        if (
            not catalogue_index
            or catalogue_index.get("schema_version") != "yahoo-batch-quote-history-index/v1"
            or catalogue_index.get("active_universe_scope") != "all_sources"
            or not isinstance(catalogue_symbols, list)
            or not catalogue_symbols
            or any(not isinstance(ticker, str) or not ticker for ticker in catalogue_symbols)
            or len(catalogue_symbols) != len(set(catalogue_symbols))
            or etf_universe_path is None
        ):
            return {}
        etf_universe = _read_json(Path(etf_universe_path))
        records = etf_universe.get("records") if etf_universe else None
        if (
            not etf_universe
            or etf_universe.get("schema_version") != "stockanalysis/v1"
            or etf_universe.get("asset_type") != "etf"
            or not isinstance(records, list)
            or not records
        ):
            return {}

        catalogue = set(catalogue_symbols)
        excluded = set(excluded_tickers or set())
        sources = {}
        for row in records:
            if not isinstance(row, dict):
                continue
            ticker = row.get("ticker")
            if (
                not isinstance(ticker, str)
                or not SYMBOL_RE.fullmatch(ticker)
                or ticker not in catalogue
                or ticker in excluded
                or row.get("asset_type", "etf") != "etf"
                or row.get("type", "etf") != "etf"
            ):
                continue
            state = _read_json(self._state_path(ticker))
            if (
                state
                and state.get("schema_version") == "yahoo-batch-quote-history-state/v1"
                and state.get("ticker") == ticker
                and state.get("resolution_state") == TERMINAL_RESOLUTION_STATE
                and not include_terminal
            ):
                continue
            sources[ticker] = ["stockanalysis_etf"]
        return {ticker: sources[ticker] for ticker in sorted(sources)}

    def terminal_tickers(self, active_universe: set[str]) -> set[str]:
        return {ticker for ticker in active_universe
                if self._load_state(ticker).get("resolution_state") == TERMINAL_RESOLUTION_STATE}

    def terminal_probe_tickers(self, active_universe: set[str], observed_at: str,
                               excluded: set[str], limit: int) -> list[str]:
        now = _iso_ms(observed_at)
        due = []
        for ticker in self.terminal_tickers(active_universe) - excluded:
            state = self._load_state(ticker)
            # Primary-reference retirements/identity changes remain authoritative.
            if (state.get("terminal") or {}).get("method") != "automatic_provider_lifecycle":
                continue
            lifecycle = state.get("provider_lifecycle") or {}
            last = lifecycle.get("last_attempt_at") or (state.get("terminal") or {}).get("classified_at")
            last_ms = _iso_ms(last)
            if last_ms is None or now - last_ms >= TERMINAL_PROBE_DAYS * 86400000:
                due.append((last_ms or 0, ticker))
        return [ticker for _, ticker in sorted(due)[:min(limit, TERMINAL_PROBES_PER_RUN)]]

    def observe_provider_attempt(self, ticker: str, run: dict, provider_data: dict | None,
                                 error: str | None, evidence: dict) -> None:
        if not run.get("natural") or run.get("event_name") != "schedule":
            return
        state = self._load_state(ticker)
        lifecycle = state.get("provider_lifecycle") or {}
        observed = run["observed_at"]
        source = _raw_payload_source_fields({"data": provider_data or {}})
        history = source["history_as_of"]
        prior_dates = [value for value in (lifecycle.get("last_history_as_of"),
                      (state.get("current") or {}).get("history_as_of"),
                      (state.get("lkg") or {}).get("history_as_of")) if _iso_ms(value) is not None]
        previous = max(prior_dates) if prior_dates else None
        advanced = bool(history and (not previous or history > previous))
        details = " ".join([str(error or ""), *[str(row.get("error") or "")
                           for row in evidence.get("failures") or []]])
        statuses = sorted({int(value) for value in re.findall(r"HTTP(?:\s+Error)?[\s:]+([45]\d\d)\b", details, re.I)})
        empty = bool(re.search(r"quote not found|empty payload", details, re.I))
        transport_error = bool(re.search(r"rate.?limit|too many requests|timed? ?out|timeout", details, re.I)
                               or any(value == 429 or value >= 500 or value in {401, 403} for value in statuses))
        stalled = bool(history and previous and history <= previous)
        qualifying = (empty or stalled) and not transport_error
        attempts = list(lifecycle.get("stalled_attempts") or []) if qualifying and not advanced else []
        if qualifying and not advanced:
            # Retries/reruns on the same UTC day are one scheduled observation.
            attempts = [row for row in attempts if row.get("observed_at", "")[:10] != observed[:10]]
            attempts.append({"observed_at": observed, "history_as_of": history,
                             "http_status": statuses[-1] if statuses else None,
                             "reason": "empty_payload" if empty else "history_not_advanced"})
        lifecycle.update({"last_attempt_at": observed, "last_history_as_of": history if advanced else previous,
                          "stalled_attempts": attempts[-AUTO_TERMINAL_ATTEMPTS:],
                          "provider_advanced": advanced,
                          "was_terminal": state.get("resolution_state") == TERMINAL_RESOLUTION_STATE})
        state["provider_lifecycle"] = lifecycle
        _write_json(self._state_path(ticker), state)

    def finalize_provider_terminal(self, ticker: str, run: dict, error: str | None) -> bool:
        if not run.get("natural") or run.get("event_name") != "schedule":
            return False
        state = self._load_state(ticker)
        lifecycle = state.get("provider_lifecycle") or {}
        failure = state.get("latest_failure") or {}
        if failure.get("data_loss"):
            return False
        history = lifecycle.get("last_history_as_of")
        age = source_business_day_age(ticker, history, run["observed_at"])
        prior_terminal = lifecycle.get("was_terminal") is True
        if prior_terminal and error is None and lifecycle.get("provider_advanced"):
            return False
        eligible_error = error is None or bool(re.search(
            r"quote not found|empty payload|source (?:timestamp regression|date regresses)|provider source timestamp regresses",
            error, re.I))
        terminal = (prior_terminal and eligible_error) or (eligible_error and isinstance(age, int)
            and age > AUTO_TERMINAL_HISTORY_BUSINESS_DAYS
            and len(lifecycle.get("stalled_attempts") or []) >= AUTO_TERMINAL_ATTEMPTS)
        if not terminal:
            return False
        prior = state.get("terminal") or {}
        state.update({"resolution_state": TERMINAL_RESOLUTION_STATE, "retry": False,
                      "terminal": {"method": "automatic_provider_lifecycle",
                                   "classified_at": prior.get("classified_at") or run["observed_at"],
                                   "last_history_as_of": history, "history_business_days": age,
                                   "attempts": lifecycle.get("stalled_attempts") or [],
                                   "last_probe_error": _bounded_error(error) if error else None}})
        state["last_result"] = {**(state.get("last_result") or {}), "outcome": "terminal",
                                "observed_at": run["observed_at"]}
        self._record_result(state, state["last_result"])
        _write_json(self._state_path(ticker), state)
        return True

    def prospective_source_stale_tickers(
        self,
        tickers: set[str],
        source_age_business_days: dict[str, int | None],
        max_source_business_days: int,
    ) -> set[str]:
        """Preview the existing bootstrap transition without persisting it."""
        return {
            ticker for ticker in tickers
            if isinstance(source_age_business_days.get(ticker), int)
            and source_age_business_days[ticker] > max_source_business_days
            and (_read_json(self._state_path(ticker)) or {}).get("resolution_state") == "fresh_primary"
            and _valid_canonical_payload(_read_json(self.finance_dir / f"{ticker}.json"), ticker)
        }

    def retry_tickers_ordered(
        self,
        active_universe: set[str],
        terminal_tickers: set[str] | None = None,
        prospective_stale_tickers: set[str] | None = None,
    ) -> list[str]:
        active = set(active_universe)
        terminal = set(terminal_tickers or set())
        prospective_stale = set(prospective_stale_tickers or set())
        retry = []
        for ticker in sorted(active):
            state = _read_json(self._state_path(ticker))
            if (
                ticker not in terminal
                and state
                and state.get("resolution_state") != TERMINAL_RESOLUTION_STATE
                and (state.get("retry") is True or (
                    ticker in prospective_stale and state.get("resolution_state") == "fresh_primary"
                ))
            ):
                observed_at = str((state.get("last_result") or {}).get("observed_at") or "")
                retry.append((observed_at, ticker))
        return [ticker for _observed_at, ticker in sorted(retry)]

    def retry_tickers(self, active_universe: set[str]) -> set[str]:
        return set(self.retry_tickers_ordered(active_universe))

    def untracked_tickers(self, active_universe: set[str]) -> set[str]:
        return {
            ticker
            for ticker in set(active_universe)
            if _read_json(self._state_path(ticker)) is None
            and ticker not in self.pending_acquisition_tickers(active_universe)
        }

    def bootstrap_existing(
        self,
        active_universe: set[str],
        sources: dict[str, list[str]],
        run: dict,
        exclude_tickers: set[str] | None = None,
        source_age_business_days: dict[str, int | None] | None = None,
        max_source_business_days: int | None = None,
    ) -> int:
        active = set(active_universe)
        excluded = set(exclude_tickers or set())
        source_ages = source_age_business_days or {}
        changed = 0
        for canonical in sorted(self.finance_dir.glob("*.json")):
            ticker = canonical.stem
            if ticker == "_summary" or ticker not in active:
                continue
            payload = _read_json(canonical)
            if not _valid_canonical_payload(payload, ticker):
                continue
            enriched = {**payload, **_payload_source_fields(payload)}
            state_path = self._state_path(ticker)
            existing = _read_json(state_path)
            age = source_ages.get(ticker)
            source_stale = (
                isinstance(age, int)
                and isinstance(max_source_business_days, int)
                and age > max_source_business_days
            )
            if existing:
                if existing.get("resolution_state") == "fresh_primary" and source_stale:
                    self._record_source_stale_lkg(
                        ticker,
                        enriched,
                        run,
                        sources.get(ticker, []),
                        age_business_days=age,
                        max_business_days=max_source_business_days,
                    )
                    changed += 1
                continue
            if ticker in excluded:
                continue
            if source_stale:
                self._record_source_stale_lkg(
                    ticker,
                    enriched,
                    run,
                    sources.get(ticker, []),
                    age_business_days=age,
                    max_business_days=max_source_business_days,
                )
            else:
                self.record_skip(ticker, enriched, run, sources.get(ticker, []))
            changed += 1
        return changed

    def _record_source_stale_lkg(
        self,
        ticker: str,
        payload: dict,
        run: dict,
        discovered_from: list[str],
        *,
        age_business_days: int,
        max_business_days: int,
    ) -> dict:
        canonical = self.finance_dir / f"{ticker}.json"
        payload_bytes = canonical.read_bytes()
        lkg_path = self._lkg_path(ticker)
        source = _payload_source_fields(payload)
        observed_at = str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        lkg = {
            "path": f"data/yf/finance/{ticker}.json",
            "payload_sha256": _sha256(payload_bytes),
            "fetched_at": payload.get("fetched_at"),
            **source,
        }
        state = self._load_state(ticker)
        state.update({
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": ticker,
            "resolution_state": "lkg_primary",
            "retry": True,
            "current": dict(lkg),
            "lkg": lkg,
            "stale": {
                "reason": "source_age_exceeds_lane_bound",
                "source_as_of": source.get("source_as_of"),
                "age_business_days": age_business_days,
                "max_business_days": max_business_days,
                "classified_at": observed_at,
                "expected_resolution": "next_yahoo_acquisition",
                "message": (
                    f"{ticker} holds LKG because Yahoo source date {source.get('source_as_of') or 'unstamped'} "
                    f"is {age_business_days} business days old, beyond the {max_business_days}-day bound; "
                    "it will retry on the next Yahoo acquisition."
                ),
            },
            "discovered_from": sorted(set(discovered_from)),
            "updated_at": observed_at,
        })
        state.pop("pending", None)
        _write_json(self._state_path(ticker), state)
        self._remove_pending_after_state(ticker)
        return state



    def evaluate_recovery_candidate(
        self, ticker: str, payload: dict, provider_payload: dict,
        *, canonical_payload: dict | None = None,
    ) -> dict:
        """Validate actual acquired values and honest retained quote/history dates."""
        if not _valid_canonical_payload(provider_payload, ticker) or not _valid_canonical_payload(payload, ticker):
            raise ValueError(f"Yahoo candidate payload is invalid for {ticker}")
        if not _contains_provider_value(payload["data"], provider_payload["data"]):
            raise ValueError(f"Yahoo candidate disagrees with actual provider values for {ticker}")
        provider_source = _payload_source_fields(provider_payload)
        if isinstance(canonical_payload, dict):
            for key, before in _payload_source_fields(canonical_payload).items():
                after = _iso_ms(provider_source.get(key))
                if key in {"quote_as_of", "history_as_of"} and _iso_ms(before) is not None and after is not None and _iso_ms(before) > after:
                    if key == "quote_as_of" and valid_illiquid_history(provider_payload):
                        continue
                    raise ValueError(f"Yahoo provider source timestamp regresses for {ticker}: {key}")
        state = self._load_state(ticker)
        prior = state.get("lkg") if state.get("retry") is True else state.get("current")
        candidate_source = _payload_source_fields(payload)
        for key in ("quote_as_of", "history_as_of"):
            before = _iso_ms((prior or {}).get(key))
            after = _iso_ms(candidate_source.get(key))
            if after is not None and (before is None or after > before):
                if after != _iso_ms(provider_source.get(key)):
                    raise ValueError(f"Yahoo candidate source date is not supplied by its provider for {ticker}: {key}")
        if not self.recovery_candidate_advances(ticker, payload):
            raise ValueError(f"Yahoo candidate source date regresses or is invalid for {ticker}")
        return {"eligible": True, "reason": "ok"}

    def valid_current_canonical(self, ticker: str, state: dict | None = None) -> bool:
        state = state if isinstance(state, dict) else self._load_state(ticker)
        current = state.get("current") if isinstance(state.get("current"), dict) else {}
        if current.get("path") != f"data/yf/finance/{ticker}.json":
            return False
        path = self.finance_dir / f"{ticker}.json"
        try:
            payload_bytes = path.read_bytes()
            payload = json.loads(payload_bytes)
        except (FileNotFoundError, json.JSONDecodeError):
            return False
        source = _payload_source_fields(payload) if isinstance(payload, dict) else {}
        return (
            _valid_canonical_payload(payload, ticker)
            and current.get("payload_sha256") == _sha256(payload_bytes)
            and all(current.get(key) == source.get(key) for key in ("quote_as_of", "history_as_of", "source_as_of"))
        )

    def recovery_candidate_advances(self, ticker: str, payload: dict) -> bool:
        if not _valid_canonical_payload(payload, ticker):
            return False
        now_ms = datetime.now(timezone.utc).timestamp() * 1000
        if _iso_ms(payload.get("fetched_at")) > now_ms:
            return False
        state = self._load_state(ticker)
        prior = state.get("lkg") if state.get("retry") is True else state.get("current")
        source = _payload_source_fields(payload)
        if state.get("resolution_state") == TERMINAL_RESOLUTION_STATE:
            previous = (state.get("provider_lifecycle") or {}).get("last_history_as_of") or (prior or {}).get("history_as_of")
            lifecycle = state.get("provider_lifecycle") or {}
            if not lifecycle.get("provider_advanced") and previous and (source.get("history_as_of") or "") <= previous:
                return False
        for key in ("quote_as_of", "history_as_of"):
            before = _iso_ms((prior or {}).get(key))
            after = _iso_ms(source.get(key))
            if before is not None and (after is None or after < before):
                if key == "quote_as_of" and valid_illiquid_history(payload):
                    continue
                return False
        return True


    def record_success(
        self,
        ticker: str,
        payload: dict,
        run: dict,
        discovered_from: list[str],
        evidence: dict,
        *,
        expected_payload_sha256: str | None = None,
    ) -> dict:
        path = self.finance_dir / f"{ticker}.json"
        payload_bytes = path.read_bytes()
        state = self._load_state(ticker)
        canonical_payload = _read_json(path)
        actual_sha256 = _sha256(payload_bytes)
        if expected_payload_sha256 is not None and actual_sha256 != expected_payload_sha256:
            raise ValueError(f"promotion candidate payload is not bound to canonical bytes for {ticker}")
        if canonical_payload != payload:
            raise ValueError(f"promotion candidate payload is not bound to canonical bytes for {ticker}")
        if not _valid_canonical_payload(canonical_payload, ticker):
            raise ValueError(f"promotion candidate canonical payload is invalid for {ticker}")
        if not self.recovery_candidate_advances(ticker, payload):
            raise ValueError(f"promotion candidate source date regresses or is invalid for {ticker}")
        pending = state.get("pending")
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        history = data.get("history_1y")
        has_history = isinstance(history, list) and len(history) > 0
        pending_reason = _pending_history_reason(payload, state, str(run.get("observed_at") or "")) if not has_history else None
        outcome = "fresh" if has_history else "pending_history" if pending_reason else "unavailable"
        attempt = _result(run, outcome, evidence)
        self._record_result(state, attempt)

        state.update({
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": ticker,
            "resolution_state": "fresh_primary" if has_history else "pending_history" if pending_reason else "unavailable",
            "retry": not has_history,
            "current": {
                "path": f"data/yf/finance/{ticker}.json",
                "payload_sha256": actual_sha256,
                "fetched_at": canonical_payload.get("fetched_at"),
                **_payload_source_fields(canonical_payload),
            },
            "discovered_from": sorted(set(discovered_from)),
            "last_result": attempt,
            "updated_at": attempt["observed_at"],
        })

        if has_history:
            if state.get("terminal"):
                state.setdefault("provider_lifecycle", {})["returned_at"] = attempt["observed_at"]
            state.pop("terminal", None)
            state.pop("pending", None)
            state.pop("latest_failure", None)
            state["failure_count"] = 0
        elif pending_reason:
            state["pending"] = {
                "missing": ["history"],
                "discovered_from": sorted(set(discovered_from)),
                "first_trade_date": payload.get("first_trade_date"),
                "first_seen_at": pending.get("first_seen_at") if isinstance(pending, dict) and pending.get("first_seen_at") else attempt["observed_at"],
                "expected_resolution": "next_yahoo_acquisition",
                "reason": pending_reason,
                "message": (
                    f"{ticker} is newly visible from {', '.join(sorted(set(discovered_from))) or 'the active universe'} "
                    "but Yahoo history is not available yet; it will retry and promote itself on the next Yahoo acquisition."
                ),
            }
        else:
            state.pop("pending", None)

        _write_json(self._state_path(ticker), state)
        self._remove_pending_after_state(ticker)
        return state

    def record_failure(
        self,
        ticker: str,
        error: str,
        run: dict,
        discovered_from: list[str],
        evidence: dict,
        *,
        failure_kind: str = "unexpected",
    ) -> dict:
        state = self._load_state(ticker)
        was_terminal = state.get("resolution_state") == TERMINAL_RESOLUTION_STATE
        previously_advertised_data = (
            state.get("resolution_state") in {"fresh_primary", "lkg_primary", "pending_history"}
            or isinstance(state.get("current"), dict)
            or isinstance(state.get("lkg"), dict)
            or (isinstance(state.get("latest_failure"), dict)
                and state["latest_failure"].get("data_loss") is True)
        )
        attempt = _result(run, "failed", evidence, error=error)
        self._record_result(state, attempt)
        canonical = self.finance_dir / f"{ticker}.json"
        lkg_path = self._lkg_path(ticker)

        lkg = None
        prior_lkg_payload = _read_json(lkg_path)
        if _valid_canonical_payload(prior_lkg_payload, ticker):
            prior_bytes = lkg_path.read_bytes()
            lkg = {
                "path": f"data/yf/finance/{ticker}.json",
                "payload_sha256": _sha256(prior_bytes),
                "fetched_at": prior_lkg_payload.get("fetched_at"),
                **_payload_source_fields(prior_lkg_payload),
            }
        canonical_payload = _read_json(canonical)
        if _valid_canonical_payload(canonical_payload, ticker) and self.recovery_candidate_advances(ticker, canonical_payload):
            payload_bytes = canonical.read_bytes()
            source = _payload_source_fields(canonical_payload)
            lkg = {
                "path": f"data/yf/finance/{ticker}.json",
                "payload_sha256": _sha256(payload_bytes),
                "fetched_at": canonical_payload.get("fetched_at"),
                **source,
            }

        lkg_status = "retained" if lkg else "lost" if previously_advertised_data else "absent"
        data_loss = lkg_status == "lost"
        deferred_acquisition = failure_kind == "transient_provider_miss" and lkg_status == "absent"
        failure = {
            "observed_at": attempt["observed_at"],
            "error": _bounded_error(error),
            "attempts_used": attempt["attempts_used"],
            "failures": attempt["failures"],
            "failure_kind": failure_kind,
            "lkg_status": lkg_status,
            "data_loss": data_loss,
            "deferred_acquisition": deferred_acquisition,
        }
        state.update({
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": ticker,
            "resolution_state": "lkg_primary" if lkg else "unavailable",
            "retry": True,
            "discovered_from": sorted(set(discovered_from)),
            "last_result": attempt,
            "latest_failure": failure,
            "failure_count": int(state.get("failure_count") or 0) + 1,
            "updated_at": attempt["observed_at"],
        })
        if was_terminal:
            # Failed probes never restore schedule membership. Unexpected failures
            # still reach the normal failed-run assessment; only valid data returns.
            state["resolution_state"] = TERMINAL_RESOLUTION_STATE
            state["retry"] = False
        if lkg:
            state["lkg"] = lkg
            state["current"] = dict(lkg)
        else:
            state.pop("lkg", None)
            state.pop("current", None)
        _write_json(self._state_path(ticker), state)
        self._remove_pending_after_state(ticker)
        return state

    def record_skip(
        self,
        ticker: str,
        payload: dict,
        run: dict,
        discovered_from: list[str],
    ) -> dict:
        path = self.finance_dir / f"{ticker}.json"
        payload_bytes = path.read_bytes()
        state = self._load_state(ticker)
        if state.get("retry") is True:
            attempt = _result(run, "skipped_retry_not_recovered", {"attempts_used": 0, "latency_ms": 0, "failures": []})
            self._record_result(state, attempt)
            state["last_result"] = attempt
            state["updated_at"] = attempt["observed_at"]
            _write_json(self._state_path(ticker), state)
            self._remove_pending_after_state(ticker)
            return state
        history = (payload.get("data") or {}).get("history_1y") if isinstance(payload.get("data"), dict) else None
        has_history = isinstance(history, list) and len(history) > 0
        attempt = _result(run, "skipped_fresh", {"attempts_used": 0, "latency_ms": 0, "failures": []})
        pending_reason = _pending_history_reason(payload, state, attempt["observed_at"]) if not has_history else None
        source = _payload_source_fields(payload)
        self._record_result(state, attempt)
        state.update({
            "schema_version": "yahoo-batch-quote-history-state/v1",
            "ticker": ticker,
            "resolution_state": "fresh_primary" if has_history else "pending_history" if pending_reason else "unavailable",
            "retry": not has_history,
            "current": {
                "path": f"data/yf/finance/{ticker}.json",
                "payload_sha256": _sha256(payload_bytes),
                "fetched_at": payload.get("fetched_at"),
                **source,
            },
            "discovered_from": sorted(set(discovered_from)),
            "last_result": attempt,
            "updated_at": attempt["observed_at"],
        })
        if pending_reason:
            state["pending"] = {
                "missing": ["history"],
                "discovered_from": sorted(set(discovered_from)),
                "first_trade_date": payload.get("first_trade_date"),
                "first_seen_at": attempt["observed_at"],
                "expected_resolution": "next_yahoo_acquisition",
                "reason": pending_reason,
            }
        else:
            state.pop("pending", None)
        _write_json(self._state_path(ticker), state)
        self._remove_pending_after_state(ticker)
        return state

    def weekly_etf_rotation(self, observed_at: str, scheduled_weekday: int) -> list[dict]:
        """Today's shard plus the oldest visit lacking committed completion."""
        if scheduled_weekday not in range(6):
            raise ValueError("ETF rotation weekday must be in 0..5")
        observed = datetime.fromisoformat(observed_at.replace("Z", "+00:00")).date()
        actual_weekday = (observed.weekday() + 1) % 7
        today = observed - timedelta(days=(actual_weekday - scheduled_weekday) % 7)
        sunday = today - timedelta(days=scheduled_weekday)
        index = _read_json(self.root / CORE_ETF_INDEX_FILENAME) or {}
        visits = index.get("weekly_shard_visits") or {}
        own = {"shard": f"{scheduled_weekday}/6", "scheduled_date": today.isoformat(), "role": "scheduled"}
        missed = []
        for shard in range(6):
            if shard == scheduled_weekday:
                continue
            due = sunday + timedelta(days=shard)
            if due > today:
                due -= timedelta(days=7)
            previous = visits.get(str(shard)) or {}
            completed = previous.get("completed_scheduled_date") or ""
            if completed < due.isoformat():
                item = {"shard": f"{shard}/6", "scheduled_date": due.isoformat(), "role": "catch_up"}
                if previous.get("last_attempt_scheduled_date") == due.isoformat() and previous.get("covered_symbols"):
                    item["covered_symbols"] = previous["covered_symbols"]
                missed.append(item)
        # Missing legacy completion evidence is unknown, so startup also gets
        # a bounded catch-up; never fabricate six successful historical visits.
        return [own, *sorted(missed, key=lambda row: row["scheduled_date"])[:1]]

    def record_weekly_etf_visits(self, index: dict, run: dict, *, accepted: bool) -> dict:
        plan = run.get("weekly_shard_plan")
        if not plan:
            return index
        visits = dict(index.get("weekly_shard_visits") or {})
        scheduled = set((run.get("scheduled_universe") or {}).get("symbols") or [])
        observed = set(self._results)
        for item in plan:
            key = item["shard"].split("/")[0]
            required = set(item["required_symbols"]) & scheduled
            prior = visits.get(key) or {}
            covered = (set(prior.get("covered_symbols") or [])
                       if prior.get("last_attempt_scheduled_date") == item["scheduled_date"] else set())
            if accepted:
                covered |= required & observed
            covered &= required
            missing = required - covered
            complete = accepted and not missing
            row = {**prior,
                   "last_attempt_at": run["observed_at"],
                   "last_attempt_scheduled_date": item["scheduled_date"],
                   "last_attempt_complete": complete,
                   "required_members": len(required), "observed_members": len(required & observed),
                   "missing_members": len(missing),
                   "covered_symbols": [] if complete else sorted(covered)}
            if complete:
                row["completed_scheduled_date"] = max(row.get("completed_scheduled_date", ""), item["scheduled_date"])
                row["completed_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            visits[key] = row
        index["weekly_shard_visits"] = visits
        _write_json(self.root / CORE_ETF_INDEX_FILENAME, index)
        return index

    def rebuild_index(self, active_universe: set[str], run: dict, batch_failure: str | None = None) -> dict:
        active = set(active_universe)
        active_universe_scope = str(run.get("active_universe_scope") or "").strip() or None
        index_filename = CORE_ETF_INDEX_FILENAME if active_universe_scope == "core_etf" else DEFAULT_INDEX_FILENAME
        previous_index = _read_json(self.root / index_filename) or {}
        scheduled_universe = run.get("scheduled_universe") or previous_index.get("scheduled_universe")
        counts = {
            "active": len(active),
            "eligible": len(active),
            "untracked": 0,
            "pending_acquisition": 0,
            "fresh": 0,
            "lkg": 0,
            "pending_history": 0,
            "unavailable": 0,
            "terminal": 0,
            "retry": 0,
            "failed": 0,
            "stale": 0,
        }
        retry_symbols = []
        pending_symbols = []
        lkg_symbols = []
        pending_details = []
        pending_acquisition_details = []
        terminal_symbols = []
        lkg_details = []
        unavailable_details = []
        failures = []
        source_rows = []
        current_results = [{"ticker": ticker, **row} for ticker, row in self._results.items() if ticker in active]
        stale_groups = {}

        inventory_items = self._load_active_universe()["items"]
        for ticker in sorted(active):
            state = self._load_state(ticker) if self._state_path(ticker).exists() else None
            if not state:
                pending_item = inventory_items.get(ticker)
                if self._is_pending_acquisition(pending_item):
                    counts["pending_acquisition"] += 1
                    pending_acquisition_details.append({"symbol": ticker, **pending_item})
                else:
                    counts["untracked"] += 1
                continue
            resolution = state.get("resolution_state")
            if resolution == "fresh_primary":
                counts["fresh"] += 1
            elif resolution == "lkg_primary":
                counts["lkg"] += 1
                lkg_symbols.append(ticker)
                lkg = state.get("lkg") if isinstance(state.get("lkg"), dict) else {}
                failure = state.get("latest_failure") if isinstance(state.get("latest_failure"), dict) else {}
                stale = state.get("stale") if isinstance(state.get("stale"), dict) else {}
                if stale.get("reason") == "source_age_exceeds_lane_bound":
                    counts["stale"] += 1
                    group_key = (
                        str(stale.get("source_as_of") or lkg.get("source_as_of") or ""),
                        int(stale.get("age_business_days") or 0),
                        int(stale.get("max_business_days") or 0),
                        str(stale.get("expected_resolution") or "next_yahoo_acquisition"),
                    )
                    stale_groups.setdefault(group_key, []).append(ticker)
                lkg_details.append({
                    "symbol": ticker,
                    "payload_sha256": lkg.get("payload_sha256"),
                    "source_as_of": lkg.get("source_as_of"),
                    "failure_observed_at": failure.get("observed_at"),
                    "state_reason": stale.get("reason"),
                    "source_age_business_days": stale.get("age_business_days"),
                    "max_source_age_business_days": stale.get("max_business_days"),
                    "expected_resolution": stale.get("expected_resolution"),
                })
            elif resolution == "pending_history":
                counts["pending_history"] += 1
                pending_symbols.append(ticker)
                pending = state.get("pending") if isinstance(state.get("pending"), dict) else {}
                pending_details.append({
                    "symbol": ticker,
                    "discovered_from": pending.get("discovered_from") or state.get("discovered_from") or [],
                    "missing": pending.get("missing") or ["history"],
                    "first_trade_date": pending.get("first_trade_date"),
                    "expected_resolution": pending.get("expected_resolution") or "next_yahoo_acquisition",
                    "reason": pending.get("reason") or "newly_discovered_no_history",
                })
            elif resolution == "unavailable":
                counts["unavailable"] += 1
                failure = state.get("latest_failure") if isinstance(state.get("latest_failure"), dict) else {}
                last_attempt = state.get("last_result") if isinstance(state.get("last_result"), dict) else {}
                evidence = failure or last_attempt
                unavailable_details.append({
                    "symbol": ticker,
                    "failure_observed_at": evidence.get("observed_at"),
                    "failure_kind": failure.get("failure_kind") or (
                        "history_unavailable" if last_attempt.get("outcome") == "unavailable" else "legacy_unclassified"
                    ),
                    "lkg_status": failure.get("lkg_status") or "absent",
                    "data_loss": failure.get("data_loss") is True,
                    "deferred_acquisition": failure.get("deferred_acquisition") is True,
                    "retry": state.get("retry") is True,
                    "expected_resolution": "next_yahoo_acquisition" if state.get("retry") is True else None,
                })
            elif resolution == TERMINAL_RESOLUTION_STATE:
                counts["terminal"] += 1
                terminal_symbols.append(ticker)
            if state.get("retry") is True and resolution != TERMINAL_RESOLUTION_STATE:
                counts["retry"] += 1
                retry_symbols.append(ticker)
            last_attempt = state.get("last_result")
            # A failed last attempt is a retry-pending failure only while the symbol
            # remains retry-capable. Terminal (provider-unsupported) classification is
            # excluded until a bounded probe recovers: its failed last attempt must not inflate
            # counts.failed beyond the strict equation failed <= lkg + pending_history
            # + unavailable. latest_attempt/last_attempt evidence stays untouched.
            if (
                isinstance(last_attempt, dict)
                and last_attempt.get("outcome") == "failed"
                and resolution != TERMINAL_RESOLUTION_STATE
            ):
                counts["failed"] += 1
            current = state.get("current") if isinstance(state.get("current"), dict) else {}
            source_as_of = current.get("source_as_of")
            if source_as_of and resolution != TERMINAL_RESOLUTION_STATE:
                source_rows.append((str(source_as_of), ticker))
            latest_failure = state.get("latest_failure")
            if isinstance(latest_failure, dict) and resolution != TERMINAL_RESOLUTION_STATE:
                failures.append({"ticker": ticker, **latest_failure})
        attempted = len(current_results) + (1 if batch_failure else 0)
        succeeded = sum(row.get("outcome") in {"fresh", "pending_history", "unavailable"} for row in current_results)
        failed = sum(row.get("outcome") == "failed" for row in current_results) + (1 if batch_failure else 0)
        skipped = sum(row.get("outcome") in {"skipped_fresh", "skipped_retry_not_recovered"} for row in current_results)
        current_failure_times = {
            row["ticker"]: _iso_ms(row.get("observed_at")) or 0
            for row in current_results
            if row.get("outcome") == "failed" and row.get("ticker")
        }
        def failure_priority(row):
            symbol = row.get("symbol") or ""
            return (symbol not in current_failure_times, -current_failure_times.get(symbol, 0), symbol)

        prioritized_lkg_details = sorted(lkg_details, key=failure_priority)
        prioritized_unavailable_details = sorted(unavailable_details, key=failure_priority)
        oldest = min(source_rows) if source_rows else (None, None)
        latest_failure = max(failures, key=lambda row: str(row.get("observed_at") or "")) if failures else None
        if batch_failure:
            latest_failure = {
                "ticker": None,
                "observed_at": str(run.get("observed_at") or ""),
                "error": _bounded_error(batch_failure),
                "scope": "batch",
            }
        index = {
            "schema_version": "yahoo-batch-quote-history-index/v1",
            "generated_at": str(run.get("observed_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
            "lane_id": "yahoo_batch_quote_history",
            "active_universe_scope": active_universe_scope,
            "counts": counts,
            "catalogue_symbols": sorted(active),
            **({"weekly_shard_visits": previous_index["weekly_shard_visits"]}
               if "weekly_shard_visits" in previous_index else {}),
            **({"scheduled_universe": scheduled_universe} if isinstance(scheduled_universe, dict) else {}),
            **({"selection": run["selection"]} if isinstance(run.get("selection"), dict) else {}),
            "oldest_source_as_of": oldest[0],
            "oldest_source_ticker": oldest[1],
            "retry_symbols": retry_symbols,
            "pending_symbols": pending_symbols[:20],
            "pending_acquisition_symbols": [row["symbol"] for row in pending_acquisition_details[:20]],
            "pending_acquisition_details": pending_acquisition_details[:20],
            "terminal_symbols": terminal_symbols[:20],
            "lkg_symbols": lkg_symbols[:20],
            "pending_details": pending_details[:20],
            "lkg_details": prioritized_lkg_details[:20],
            "unavailable_details": prioritized_unavailable_details[:20],
            "stale_groups": [
                {
                    "source_as_of": key[0] or None,
                    "source_age_business_days": key[1],
                    "max_source_age_business_days": key[2],
                    "expected_resolution": key[3],
                    "symbols": sorted(symbols),
                }
                for key, symbols in sorted(stale_groups.items())
            ],
            "latest_failure": latest_failure,
            "current_results": {
                "observed_at": run.get("observed_at") if attempted > skipped else None,
                "attempted": attempted,
                "successes": succeeded,
                "failed": failed,
                "skipped": skipped,
                "terminal_symbols": [row["ticker"] for row in current_results if row.get("outcome") == "terminal"],
                "fetch_attempts": sum(int(row.get("attempts_used") or 0) for row in current_results) + (1 if batch_failure else 0),
                "errors": [
                    {"ticker": row["ticker"], "error": row.get("error"), "failures": row.get("failures") or []}
                    for row in current_results
                    if row.get("outcome") == "failed"
                ] + ([{"ticker": None, "error": _bounded_error(batch_failure), "scope": "batch"}] if batch_failure else []),
            },
            "message": (
                f"Yahoo quote/history: fresh={counts['fresh']}, lkg={counts['lkg']}, "
                f"pending_history={counts['pending_history']}, unavailable={counts['unavailable']}, "
                f"pending_acquisition={counts['pending_acquisition']}, terminal={counts['terminal']}, "
                f"catalogue={counts['active']}, eligible={counts['eligible']}, "
                f"retry={counts['retry']}, failed={counts['failed']}, source_stale={counts['stale']}. "
                "Pending history is a normal new-listing state and self-resolves on the next Yahoo acquisition."
            ),
        }
        _write_json(self.root / index_filename, index)
        return index


# The generation retains observations that prices cannot reconstruct. Payload
# pointers, hashes, source clocks, retry flags and KPI counts are rebuilt.
GENERATION_OBSERVATION_KEYS = (
    "terminal", "provider_lifecycle", "latest_failure", "failure_count", "last_result",
)


def export_generation_state(root: Path, yf_root: Path) -> dict:
    store = YahooBatchStateStore(root, yf_root / "finance")
    tickers = {}
    clocks = []
    for path in sorted(store.ticker_dir.glob("*.json")):
        state = store._load_state(path.stem)
        item = {key: state[key] for key in GENERATION_OBSERVATION_KEYS if key in state}
        first_seen = (state.get("pending") or {}).get("first_seen_at")
        if first_seen:
            item["first_seen_at"] = first_seen
        if item:
            tickers[path.stem] = item
        clocks.extend(value for value in ((state.get("provider_lifecycle") or {}).get("last_attempt_at"),
                      (state.get("last_result") or {}).get("observed_at")) if _iso_ms(value) is not None)
    universes = {}
    for name in (DEFAULT_INDEX_FILENAME, CORE_ETF_INDEX_FILENAME):
        index = _read_json(root / name) or {}
        if index:
            # Membership and selection describe the actual acquisition event;
            # retained payloads include other runs and cannot reconstruct it.
            universes[name] = {key: index[key] for key in (
                "catalogue_symbols", "active_universe_scope", "scheduled_universe",
                "selection", "weekly_shard_visits", "generated_at", "current_results",
            ) if key in index}
            if _iso_ms(index.get("generated_at")) is not None:
                clocks.append(index["generated_at"])
    first_seen = {
        ticker: {key: row[key] for key in ("first_seen_at", "first_seen_from") if key in row}
        for ticker, row in store._load_active_universe()["items"].items()
        if isinstance(row, dict) and row.get("first_seen_at")
    }
    if not clocks:
        raise ValueError("Yahoo generation has no actual acquisition observation timestamp")
    observed = max(clocks, key=_iso_ms)
    payload = {"schema_version": "yahoo-generation-observations/v1", "observed_at": observed,
               "tickers": tickers, "first_seen": first_seen, "universes": universes}
    _write_json(yf_root / "_acquisition-state.json", payload)
    return payload


def hydrate_generation_state(root: Path, yf_root: Path) -> dict:
    metadata = _read_json(yf_root / "_acquisition-state.json")
    if not isinstance(metadata, dict) or metadata.get("schema_version") != "yahoo-generation-observations/v1":
        raise ValueError("active Yahoo generation lacks acquisition observations")
    observed = metadata["observed_at"]
    store = YahooBatchStateStore(root, yf_root / "finance")
    retained = metadata.get("tickers") or {}
    # Tracker histories are sibling assets, not separate acquisition tickers.
    # Keep them in the generation without overwriting the canonical ticker state.
    payloads = {path.stem: path for path in store.finance_dir.glob("*.json")
                if not path.name.startswith("_") and not path.name.endswith(".unadjusted.json")}
    sources = {}
    for ticker in sorted(set(payloads) | set(retained)):
        if not SYMBOL_RE.fullmatch(ticker):
            raise ValueError(f"invalid Yahoo generation ticker: {ticker}")
        saved = retained.get(ticker) or {}
        state = {"schema_version": "yahoo-batch-quote-history-state/v1", "ticker": ticker,
                 **{key: saved[key] for key in GENERATION_OBSERVATION_KEYS if key in saved}}
        if saved.get("first_seen_at"):
            state["pending"] = {"first_seen_at": saved["first_seen_at"]}
        path = payloads.get(ticker)
        payload = _read_json(path) if path else None
        valid = _valid_canonical_payload(payload, ticker)
        if valid:
            state["current"] = {"path": f"data/yf/finance/{ticker}.json",
                                "payload_sha256": _sha256(path.read_bytes()),
                                "fetched_at": payload.get("fetched_at"), **_payload_source_fields(payload)}
        if valid:
            sources[ticker] = state["current"].get("source_as_of")
        history = (payload.get("data") or {}).get("history_1y") if valid else None
        has_history = isinstance(history, list) and bool(history)
        failed = (state.get("last_result") or {}).get("outcome") in {"failed", "skipped_retry_not_recovered"}
        pending = _pending_history_reason(payload, state, observed) if valid and not has_history else None
        terminal = bool(state.get("terminal"))
        state["resolution_state"] = (TERMINAL_RESOLUTION_STATE if terminal else
                                     "lkg_primary" if valid and failed else
                                     "fresh_primary" if has_history else
                                     "pending_history" if pending else "unavailable")
        state["retry"] = not terminal and (failed or not has_history)
        if valid and failed:
            state["lkg"] = dict(state["current"])
        state["updated_at"] = (state.get("last_result") or {}).get("observed_at") or observed
        _write_json(store._state_path(ticker), state)
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    freshness = source_freshness_contract(sources, now)
    for ticker, age in freshness["ages"].items():
        state = store._load_state(ticker)
        if state.get("resolution_state") == "fresh_primary" and isinstance(age, int) and age > freshness["max_source_business_days"]:
            store._record_source_stale_lkg(ticker, _read_json(payloads[ticker]), {"observed_at": now}, [],
                                          age_business_days=age, max_business_days=freshness["max_source_business_days"])
    items = {ticker: {**row, "resolution_state": "pending_acquisition", "coverage": False,
                     "coverage_status": "not_observed", "provider_reachability": "not_attempted"}
             for ticker, row in (metadata.get("first_seen") or {}).items() if ticker not in retained and ticker not in payloads}
    _write_json(store.active_universe_path, {"schema_version": ACTIVE_UNIVERSE_SCHEMA_VERSION, "items": items})
    for name, event in (metadata.get("universes") or {}).items():
        if name not in {DEFAULT_INDEX_FILENAME, CORE_ETF_INDEX_FILENAME}:
            raise ValueError(f"invalid Yahoo generation universe: {name}")
        _write_json(root / name, event)
        # The acquisition run's own summary travels with its event. Per-ticker
        # result clocks differ inside one run, so matching them to the event
        # clock recovered only the last ticker; that match remains only for
        # generations exported before the summary was carried.
        exported = event.get("current_results")
        store._results = {} if isinstance(exported, dict) else {
            ticker: row["last_result"] for ticker, row in retained.items()
            if (row.get("last_result") or {}).get("observed_at") == event.get("generated_at")}
        index = store.rebuild_index(set(event.get("catalogue_symbols") or []), {
            "observed_at": event.get("generated_at") or observed,
            "active_universe_scope": event.get("active_universe_scope"),
            "scheduled_universe": event.get("scheduled_universe"), "selection": event.get("selection"),
        })
        if isinstance(exported, dict):
            _write_json(root / name, {**index, "current_results": exported})
    return metadata


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("export-generation", "hydrate-generation"))
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--yf-root", type=Path, default=Path(__file__).resolve().parent.parent / "data/yf")
    args = parser.parse_args()
    operation = export_generation_state if args.action == "export-generation" else hydrate_generation_state
    result = operation(args.state_root, args.yf_root)
    print(json.dumps({"observed_at": result["observed_at"], "tickers": len(result["tickers"])}))
