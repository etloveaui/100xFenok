"""
Percent Value Parser
====================

Parses percentage values from various formats in Damodaran datasets.
"""

from typing import Any, Optional


def parse_percent(val: Any) -> Optional[float]:
    """
    Parse percent value from various formats.

    Handles:
    - Float already in decimal form: 0.0433 -> 0.0433
    - Float in percent form: 4.33 -> 0.0433
    - String with % sign: "4.33%" -> 0.0433
    - None or invalid -> None

    Args:
        val: Value to parse (float, int, str, or None)

    Returns:
        Float in decimal form (e.g., 0.0433 for 4.33%), or None if invalid

    Examples:
        >>> parse_percent(0.0433)
        0.0433
        >>> parse_percent(4.33)
        0.0433
        >>> parse_percent("4.33%")
        0.0433
        >>> parse_percent("N/A")
        None
    """
    if val is None:
        return None

    # Already numeric
    if isinstance(val, (int, float)):
        # Distinguish between decimal (< 1) and percent (>= 1)
        if abs(val) < 1:
            return float(val)
        return float(val) / 100

    # String handling
    val_str = str(val).strip()

    # Skip invalid values
    if val_str.upper() in ["", "N/A", "#N/A", "NA", "NAN", "-"]:
        return None

    # Remove % sign
    val_str = val_str.replace("%", "").strip()

    try:
        num = float(val_str)
        # If absolute value >= 1, assume it's in percent form
        return num / 100 if abs(num) >= 1 else num
    except ValueError:
        return None


def parse_ratio(val: Any) -> Optional[float]:
    """
    Parse ratio value (not percentage).

    Unlike parse_percent, this doesn't divide by 100.
    Used for values like D/E ratio, EV/Sales, etc.

    Args:
        val: Value to parse

    Returns:
        Float value or None if invalid

    Examples:
        >>> parse_ratio(1.23)
        1.23
        >>> parse_ratio("1.23")
        1.23
    """
    if val is None:
        return None

    if isinstance(val, (int, float)):
        return float(val)

    val_str = str(val).strip()

    if val_str.upper() in ["", "N/A", "#N/A", "NA", "NAN", "-"]:
        return None

    try:
        return float(val_str)
    except ValueError:
        return None


def parse_int(val: Any) -> Optional[int]:
    """
    Parse integer value.

    Used for values like num_firms.

    Args:
        val: Value to parse

    Returns:
        Integer value or None if invalid
    """
    if val is None:
        return None

    if isinstance(val, int):
        return val

    if isinstance(val, float):
        return int(val)

    val_str = str(val).strip()

    if val_str.upper() in ["", "N/A", "#N/A", "NA", "NAN", "-"]:
        return None

    try:
        return int(float(val_str))
    except ValueError:
        return None
