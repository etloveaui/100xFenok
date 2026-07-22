#!/usr/bin/env python3
"""
SlickCharts Scraper Utilities Module

Shared utility functions for all SlickCharts scrapers.
Eliminates ~1,200 lines of duplicated code across 27 scrapers.

Usage:
    from scraper_utils import (
        fetch_html, clean_number, to_float,
        create_scraper_parser, build_standard_payload,
        extract_js_state, find_table
    )

Created: 2026-01-10
Reference: docs/planning/slickcharts-data-pipeline.md
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import requests
from bs4 import BeautifulSoup, Tag
from requests import Response, Session

# ==============================================================================
# Constants
# ==============================================================================

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
MAX_RETRIES = 3
RATE_LIMIT_SECONDS = 1.5
REQUEST_TIMEOUT = 30


# ==============================================================================
# HTTP Functions
# ==============================================================================

def _returned_attempt_tuple(
    status: int,
    *,
    auth: str = "not_applicable",
    rate_limited: bool = False,
    decode: str = "not_attempted",
    payload: str = "not_available",
    assertions: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    return {
        "execution": "returned",
        "exception_kind": None,
        "http_status": status,
        "auth": auth,
        "rate_limited": rate_limited,
        "decode": decode,
        "payload": payload,
        "assertions": assertions or [],
    }


def _threw_attempt_tuple(exception_kind: str) -> Dict[str, Any]:
    return {
        "execution": "threw",
        "exception_kind": exception_kind,
        "http_status": None,
        "auth": "not_applicable",
        "rate_limited": False,
        "decode": "not_attempted",
        "payload": "not_available",
        "assertions": [],
    }


def _emit_attempt_tuple(row: Dict[str, Any]) -> None:
    target = os.environ.get("SLICKCHARTS_ATTEMPT_EVENTS_PATH")
    if not target:
        return
    path = Path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(row, separators=(",", ":")) + "\n").encode("utf-8")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(descriptor, data)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _returned_failure_tuple(status: int) -> Dict[str, Any]:
    if status in (401, 403):
        return _returned_attempt_tuple(status, auth="rejected")
    if status == 429:
        return _returned_attempt_tuple(status, rate_limited=True)
    return _returned_attempt_tuple(status)


def _html_attempt_tuple(status: int, html: str) -> Dict[str, Any]:
    if not html.strip():
        return _returned_attempt_tuple(status, decode="ok", payload="empty")
    soup = BeautifulSoup(html, "html.parser")
    has_rows = any(row.find("td") is not None for row in soup.select("table tr"))
    return _returned_attempt_tuple(
        status,
        decode="ok",
        payload="non_empty",
        assertions=[{"id": "table_rows", "passed": has_rows}],
    )

def decode_response_html(response: Response) -> str:
    """Decode SlickCharts bytes as UTF-8 before Requests' latin-1 default."""
    raw = response.content
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        # Preserve compatibility for a genuinely non-UTF-8 upstream response.
        # This fallback is intentionally second: response.text may otherwise
        # decode charset-less text/html as latin-1 and permanently mojibake
        # non-ASCII labels before the JSON intermediate/merge stages.
        encoding = response.encoding or response.apparent_encoding
        return raw.decode(encoding)


def fetch_html_playwright(
    url: str,
    *,
    wait_for_selector: str = "table.table",
    timeout: int = 60000,
    user_agent: Optional[str] = None,
    viewport: Optional[Dict[str, int]] = None,
    wait_until: str = "domcontentloaded",
    retry: int = 0,
    challenge_detector: Optional[Callable[[str], bool]] = None,
    post_load_wait_ms: int = 0,
) -> str:
    """
    Fetch HTML content using Playwright headless browser.
    Use for pages protected by Cloudflare or requiring JavaScript rendering.

    Args:
        url: Target URL to fetch
        wait_for_selector: CSS selector to wait for before capturing HTML
        timeout: Navigation timeout in milliseconds (default: 60000)
        user_agent: Optional browser context user agent override
        viewport: Optional browser context viewport override
        wait_until: Playwright wait_until mode (default: domcontentloaded)
        retry: Additional attempts after the initial fetch (default: 0)
        challenge_detector: Optional callable that returns True when HTML looks like a challenge page
        post_load_wait_ms: Optional delay after navigation/load-state before selector wait

    Returns:
        Rendered HTML content as string

    Raises:
        RuntimeError: If page load or selector wait times out
    """
    from playwright.sync_api import (
        Error as PlaywrightError,
        TimeoutError as PlaywrightTimeout,
        sync_playwright,
    )

    attempts = retry + 1
    last_error: Exception | None = None
    last_status: int | None = None
    effective_user_agent = user_agent or USER_AGENT

    for attempt in range(1, attempts + 1):
        status: int | None = None
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context_options = {
                    "user_agent": effective_user_agent,
                }
                if viewport is not None:
                    context_options["viewport"] = viewport
                context = browser.new_context(**context_options)
                page = context.new_page()
                navigation = page.goto(url, wait_until=wait_until, timeout=timeout)
                status = navigation.status if navigation is not None else 200
                if post_load_wait_ms > 0:
                    page.wait_for_timeout(post_load_wait_ms)
                page.wait_for_selector(wait_for_selector, timeout=15000)
                page.wait_for_timeout(1200)
                html = page.content()
                title = page.title()
                context.close()
                browser.close()

            if challenge_detector and challenge_detector(html):
                raise RuntimeError(f"Challenge page detected for {url} (title={title})")

            _emit_attempt_tuple(_html_attempt_tuple(status, html))
            return html
        except (PlaywrightError, RuntimeError) as exc:
            last_error = exc
            if isinstance(status, int) and 100 <= status <= 599:
                last_status = status
            if attempt == attempts:
                break
            time.sleep(RATE_LIMIT_SECONDS)
            continue

    if last_error is None:
        _emit_attempt_tuple(_threw_attempt_tuple("unexpected"))
        raise RuntimeError(f"Playwright failed fetching {url}")
    if last_status is not None:
        if 200 <= last_status < 300:
            _emit_attempt_tuple(_returned_attempt_tuple(
                last_status,
                decode="ok",
                payload="non_empty",
                assertions=[{"id": "table_rows", "passed": False}],
            ))
        else:
            _emit_attempt_tuple(_returned_failure_tuple(last_status))
    else:
        kind = "transport" if isinstance(last_error, PlaywrightError) else "unexpected"
        _emit_attempt_tuple(_threw_attempt_tuple(kind))
    raise RuntimeError(f"Playwright failed fetching {url}: {last_error}") from last_error


def fetch_html(
    session: Session,
    url: str,
    *,
    user_agent: str = USER_AGENT,
    max_retries: int = MAX_RETRIES,
    rate_limit: float = RATE_LIMIT_SECONDS,
    timeout: int = REQUEST_TIMEOUT,
) -> str:
    """
    Fetch HTML content with retries and polite rate limiting.

    Args:
        session: requests.Session instance
        url: Target URL to fetch
        user_agent: User-Agent header (default: Chrome-like)
        max_retries: Maximum retry attempts (default: 3)
        rate_limit: Delay between requests in seconds (default: 1.5)
        timeout: Request timeout in seconds (default: 30)

    Returns:
        HTML content as string

    Raises:
        RuntimeError: If all retry attempts fail
    """
    last_error: Exception | None = None

    for attempt in range(1, max_retries + 1):
        try:
            time.sleep(rate_limit)
            response: Response = session.get(
                url,
                headers={"User-Agent": user_agent},
                timeout=timeout,
            )
            if response.status_code >= 500:
                raise requests.HTTPError(
                    f"Upstream error {response.status_code}",
                    response=response,
                )
            response.raise_for_status()
            try:
                html = decode_response_html(response)
            except Exception:
                _emit_attempt_tuple(_returned_attempt_tuple(response.status_code, decode="error"))
                raise RuntimeError(f"Unable to decode {url}")
            _emit_attempt_tuple(_html_attempt_tuple(response.status_code, html))
            return html
        except requests.RequestException as exc:
            last_error = exc
            if attempt == max_retries:
                break
            continue

    response = getattr(last_error, "response", None)
    status = getattr(response, "status_code", None)
    if isinstance(status, int) and 100 <= status <= 599:
        _emit_attempt_tuple(_returned_failure_tuple(status))
    else:
        _emit_attempt_tuple(_threw_attempt_tuple("transport"))
    raise RuntimeError(f"Unable to fetch {url}") from last_error


# ==============================================================================
# Number Parsing Functions
# ==============================================================================

def clean_number(value: str, *, chars_to_remove: str = ",%$()+") -> str:
    """
    Remove formatting artifacts from numeric strings.

    Args:
        value: String value to clean
        chars_to_remove: Characters to strip (default: common financial chars)

    Returns:
        Cleaned string ready for numeric conversion

    Examples:
        >>> clean_number("1,234.56")
        '1234.56'
        >>> clean_number("-12.5%")
        '-12.5'
        >>> clean_number("$1,000")
        '1000'
    """
    result = value
    for char in chars_to_remove:
        result = result.replace(char, "")
    return result.strip()


def to_float(value: str, *, default: Optional[float] = 0.0) -> Optional[float]:
    """
    Convert string to float with automatic cleanup.

    Args:
        value: String value to convert
        default: Value to return if conversion fails (default: 0.0)

    Returns:
        Float value or default
    """
    stripped = clean_number(value)
    if not stripped:
        return default
    try:
        number = float(stripped)
        return number if math.isfinite(number) else default
    except ValueError:
        return default


def to_int(value: str, *, default: int = 0) -> int:
    """
    Convert string to int with automatic cleanup.

    Args:
        value: String value to convert
        default: Value to return if conversion fails (default: 0)

    Returns:
        Integer value or default
    """
    stripped = clean_number(value)
    if not stripped:
        return default
    try:
        return int(float(stripped))  # Handle "1.0" -> 1
    except ValueError:
        return default


# ==============================================================================
# HTML Parsing Functions
# ==============================================================================

def find_table(
    soup: BeautifulSoup,
    *,
    header_text: Optional[str] = None,
    selector: Optional[str] = None,
    fallback_selector: str = "table.table",
) -> Tag:
    """
    Find a table element using multiple strategies.

    Args:
        soup: BeautifulSoup parsed document
        header_text: Text to search in preceding h1/h2 (optional)
        selector: CSS selector for direct lookup (optional)
        fallback_selector: Fallback CSS selector (default: table.table)

    Returns:
        BeautifulSoup Tag representing the table

    Raises:
        ValueError: If no table is found
    """
    table = None

    # Strategy 1: Find by preceding header text
    if header_text:
        header = soup.find(["h1", "h2"], string=lambda t: t and header_text in t)
        if header:
            container = header.find_next("div", class_="table-responsive")
            table = container.find("table") if container else header.find_next("table")

    # Strategy 2: Direct CSS selector
    if table is None and selector:
        table = soup.select_one(selector)

    # Strategy 3: Fallback selector
    if table is None:
        table = soup.select_one(fallback_selector)

    if table is None:
        raise ValueError("Unable to locate table on the page")

    return table


def extract_table_rows(
    table: Tag,
    *,
    min_columns: int = 2,
    skip_header: bool = True,
) -> List[List[str]]:
    """
    Extract text content from table rows.

    Args:
        table: BeautifulSoup table element
        min_columns: Minimum columns required (default: 2)
        skip_header: Skip rows in thead (default: True)

    Returns:
        List of rows, each row is a list of cell text values
    """
    rows: List[List[str]] = []
    selector = "tbody tr" if skip_header else "tr"

    for row in table.select(selector):
        cells = row.find_all("td")
        if len(cells) < min_columns:
            continue
        row_data = [cell.get_text(strip=True) for cell in cells]
        rows.append(row_data)

    return rows


# ==============================================================================
# JavaScript State Extraction
# ==============================================================================

def _balanced_object(source: str, start: int) -> str:
    """Return one balanced JavaScript object starting at ``start``."""
    if start < 0 or start >= len(source) or source[start] != "{":
        raise ValueError("JavaScript object start was not found")

    depth = 0
    quote: str | None = None
    escaped = False
    for index in range(start, len(source)):
        char = source[index]
        if quote is not None:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in ('"', "'"):
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start:index + 1]

    raise ValueError("JavaScript object is not balanced")


def _parse_svelte_data_object(html: str) -> Dict[str, Any]:
    """Parse the SvelteKit page-data object now emitted by SlickCharts."""
    marker = re.search(r'data\s*:\s*\[null,\s*\{type\s*:\s*"data",\s*data\s*:', html)
    if marker is None:
        raise ValueError("Could not find SlickCharts SvelteKit page data")

    object_start = html.find("{", marker.end())
    javascript = _balanced_object(html, object_start)
    # SlickCharts emits a JSON-compatible object literal except for unquoted
    # property names and JavaScript's leading-decimal numeric shorthand.
    parts = re.split(r'("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')', javascript)
    for index in range(0, len(parts), 2):
        parts[index] = re.sub(
            r'([,{])\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:',
            r'\1"\2":',
            parts[index],
        )
        parts[index] = re.sub(
            r'(?<![A-Za-z0-9_.])(-?)\.(\d+)',
            r'\g<1>0.\2',
            parts[index],
        )
    normalized = "".join(parts)
    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Failed to parse SlickCharts SvelteKit page data: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError("SlickCharts SvelteKit page data is not an object")
    return parsed


def extract_js_state(html: str, *, var_name: str = "__sc_init_state__") -> Dict[str, Any]:
    """
    Extract JavaScript state object from HTML.

    Used for scrapers that need to parse data from embedded JavaScript
    (e.g., performance, analysis, drawdown scrapers).

    Args:
        html: Raw HTML content
        var_name: JavaScript variable name (default: __sc_init_state__)

    Returns:
        Parsed dictionary from JavaScript object

    Raises:
        ValueError: If state object cannot be found or parsed
    """
    # Pattern to match the JavaScript state object
    pattern = rf'{var_name}\s*=\s*(\{{.*?\}})\s*(?:</script>|;)'
    match = re.search(pattern, html, re.DOTALL)

    if not match:
        if var_name == "__sc_init_state__":
            return _parse_svelte_data_object(html)
        raise ValueError(f"Could not find {var_name} in page")

    json_str = match.group(1)

    # Find complete JSON by counting braces
    brace_count = 0
    end_idx = 0
    for i, char in enumerate(json_str):
        if char == '{':
            brace_count += 1
        elif char == '}':
            brace_count -= 1
            if brace_count == 0:
                end_idx = i + 1
                break

    json_str = json_str[:end_idx]

    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse JavaScript state: {e}") from e


# ==============================================================================
# CLI Functions
# ==============================================================================

def create_scraper_parser(
    description: str,
    *,
    default_output: Optional[Path] = None,
) -> argparse.ArgumentParser:
    """
    Create standard argument parser for scrapers.

    Args:
        description: Scraper description for help text
        default_output: Default output file path (optional)

    Returns:
        Configured ArgumentParser instance
    """
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=default_output,
        help=f"Output JSON path (default: {default_output or 'stdout'})",
    )
    parser.add_argument(
        "--pretty", "-p",
        action="store_true",
        help="Pretty-print JSON with indentation.",
    )
    return parser


# ==============================================================================
# Payload Functions
# ==============================================================================

def build_standard_payload(
    data: Any,
    *,
    source: str = "slickcharts",
    count_key: Optional[str] = "count",
    data_key: str = "data",
    extra_fields: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Build standardized JSON payload structure.

    Args:
        data: Main data content (list or dict)
        source: Data source identifier (default: slickcharts)
        count_key: Key for count field, None to omit (default: count)
        data_key: Key for data field (default: data)
        extra_fields: Additional fields to include (optional)

    Returns:
        Standardized payload dictionary
    """
    payload: Dict[str, Any] = {
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": source,
    }

    if count_key and isinstance(data, list):
        payload[count_key] = len(data)

    payload[data_key] = data

    if extra_fields:
        payload.update(extra_fields)

    return payload


def write_output(
    payload: Dict[str, Any],
    output: Optional[Path],
    *,
    pretty: bool = False,
) -> None:
    """
    Write payload to file or stdout.

    Args:
        payload: Dictionary to serialize as JSON
        output: Output file path, None for stdout
        pretty: Pretty-print with indentation (default: False)
    """
    indent = 2 if pretty else None
    json_str = json.dumps(payload, indent=indent, ensure_ascii=False, allow_nan=False)

    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json_str, encoding="utf-8")
    else:
        print(json_str)


# ==============================================================================
# Utility Functions
# ==============================================================================

def get_utc_timestamp() -> str:
    """
    Get current UTC timestamp in ISO format.

    Returns:
        ISO 8601 formatted timestamp without microseconds
    """
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def create_session() -> Session:
    """
    Create a configured requests session.

    Returns:
        requests.Session with default settings
    """
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


# ==============================================================================
# Cumulative Data Functions
# ==============================================================================

DEFAULT_RETENTION_DAYS = 90


def load_existing_history(file_path: Path) -> List[Dict[str, Any]]:
    """
    Load existing history from a cumulative JSON file.

    Args:
        file_path: Path to the JSON file

    Returns:
        List of historical entries, empty list if file doesn't exist
    """
    if not file_path.exists():
        return []

    try:
        data = json.loads(
            file_path.read_text(encoding="utf-8"),
            parse_constant=lambda _token: None,
        )
        return data.get("history", [])
    except (json.JSONDecodeError, KeyError):
        return []


def prune_old_entries(
    history: List[Dict[str, Any]],
    *,
    retention_days: int = DEFAULT_RETENTION_DAYS,
) -> List[Dict[str, Any]]:
    """
    Remove entries older than retention period.

    Args:
        history: List of historical entries with 'date' field
        retention_days: Days to keep (default: 90)

    Returns:
        Pruned history list
    """
    if not history:
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    cutoff_str = cutoff.strftime("%Y-%m-%d")

    return [entry for entry in history if entry.get("date", "") >= cutoff_str]


def build_cumulative_payload(
    new_data: Any,
    existing_history: List[Dict[str, Any]],
    *,
    source: str = "slickcharts",
    data_key: str = "data",
    retention_days: int = DEFAULT_RETENTION_DAYS,
) -> Dict[str, Any]:
    """
    Build cumulative payload with history.

    Args:
        new_data: Today's data (list or dict)
        existing_history: Previous history entries
        source: Data source identifier
        data_key: Key name for data in history entry
        retention_days: Days to retain

    Returns:
        Cumulative payload with history array
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    # Create today's entry
    today_entry: Dict[str, Any] = {
        "date": today,
    }

    if isinstance(new_data, list):
        today_entry["count"] = len(new_data)

    today_entry[data_key] = new_data

    # Remove duplicate date entry if exists
    filtered_history = [e for e in existing_history if e.get("date") != today]

    # Prepend today's entry
    updated_history = [today_entry] + filtered_history

    # Prune old entries
    pruned_history = prune_old_entries(updated_history, retention_days=retention_days)

    return {
        "updated": timestamp,
        "source": source,
        "history": pruned_history,
    }


def write_cumulative_output(
    payload: Dict[str, Any],
    output: Path,
    *,
    pretty: bool = False,
) -> None:
    """
    Write cumulative payload to file.

    Args:
        payload: Cumulative payload with history
        output: Output file path
        pretty: Pretty-print with indentation
    """
    indent = 2 if pretty else None
    json_str = json.dumps(payload, indent=indent, ensure_ascii=False, allow_nan=False)

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json_str, encoding="utf-8")


def add_cumulative_args(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    """
    Add cumulative mode arguments to parser.

    Args:
        parser: Existing ArgumentParser

    Returns:
        Parser with added arguments
    """
    parser.add_argument(
        "--cumulative", "-c",
        action="store_true",
        help="Enable cumulative mode (append to history).",
    )
    parser.add_argument(
        "--retention-days",
        type=int,
        default=DEFAULT_RETENTION_DAYS,
        help=f"Days to retain in history (default: {DEFAULT_RETENTION_DAYS}).",
    )
    return parser
