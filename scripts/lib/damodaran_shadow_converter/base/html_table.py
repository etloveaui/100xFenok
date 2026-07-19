"""
HTML table helpers for Damodaran current-year pages.
"""

from io import BytesIO
import math
import re
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd


def is_html_content(content: bytes) -> bool:
    """Return True when downloaded bytes look like an HTML document."""
    head = content[:512].lstrip().lower()
    return head.startswith(b"<") or b"<html" in head or b"<table" in head


def read_first_table(content: bytes) -> pd.DataFrame:
    """Read the first HTML table and promote the row containing Industry/Year headers."""
    tables = pd.read_html(BytesIO(content))
    if not tables:
        raise ValueError("No HTML tables found")

    df = tables[0].copy()
    header_idx = None
    for idx in range(min(8, len(df))):
        row_values = [normalize_text(v) for v in df.iloc[idx].tolist()]
        if any("industryname" in v for v in row_values) or any(v == "year" for v in row_values):
            header_idx = idx
            break

    if header_idx is not None:
        headers = [str(v).strip() for v in df.iloc[header_idx].tolist()]
        df = df.iloc[header_idx + 1 :].reset_index(drop=True)
        df.columns = headers

    return df


def normalize_text(value: Any) -> str:
    """Normalize table labels for loose column matching."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    text = str(value).replace("\xa0", " ").strip().lower()
    return re.sub(r"[^a-z0-9]+", "", text)


def find_column(columns: Iterable[Any], *needles: str) -> Optional[Any]:
    """Find the first column whose normalized name contains all normalized needles."""
    normalized_needles = [normalize_text(n) for n in needles]
    for col in columns:
        col_norm = normalize_text(col)
        if all(needle in col_norm for needle in normalized_needles):
            return col
    return None


def build_column_map(columns: Iterable[Any], specs: Dict[str, List[str]]) -> Dict[str, Any]:
    """
    Build a map from semantic field names to DataFrame column names.

    specs values are alternative match expressions. An expression can include
    "&&" to require multiple substrings in the same column.
    """
    result: Dict[str, Any] = {}
    for field, alternatives in specs.items():
        for expr in alternatives:
            parts = [part.strip() for part in expr.split("&&")]
            col = find_column(columns, *parts)
            if col is not None:
                result[field] = col
                break
    return result


def parse_number(value: Any, percent: bool = False) -> Optional[float]:
    """
    Parse Damodaran HTML cell values.

    Removes currency marks, commas and percent signs. Parentheses are treated as
    negatives.
    """
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (int, float)):
        num = float(value)
        return num / 100 if percent and abs(num) >= 1 else num

    text = str(value).strip()
    if text.upper() in {"", "N/A", "#N/A", "NA", "NAN", "-"}:
        return None

    negative = text.startswith("(") and text.endswith(")")
    cleaned = (
        text.replace("$", "")
        .replace(",", "")
        .replace("%", "")
        .replace("(", "")
        .replace(")", "")
        .strip()
    )
    if cleaned.upper() in {"", "N/A", "#N/A", "NA", "NAN", "-"}:
        return None

    try:
        num = float(cleaned)
    except ValueError:
        return None
    if negative:
        num = -num
    if "%" in text:
        return num / 100
    if percent:
        return num / 100 if abs(num) >= 1 else num
    return num


def parse_int_value(value: Any) -> Optional[int]:
    """Parse integer-like Damodaran cell values."""
    num = parse_number(value)
    return int(num) if num is not None else None
