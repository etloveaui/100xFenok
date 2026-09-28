"""One bounded, redacting diagnostic detail for Python producers.

A producer that fails and reports only a reason enum cannot be diagnosed. Two
outages this week ran for days behind exactly that: a bare `catch` that
discarded the error, and a log truncated at 80 characters whose cut landed
inside the cause. Detail must survive - beside the reason enum, never inside
it, because stores and the detection floor consume that vocabulary.

Detail that reaches a log is detail that reaches a public CI run, so redaction
is not optional. The first version of this helper was duplicated into three
fetchers, the copies drifted, and all three shipped the same hole: a
word-boundary credential pattern cannot match inside `client_secret`, and this
repo authenticates FINRA with FINRA_API_CLIENT_ID / FINRA_API_CLIENT_SECRET.
That is why this lives in one place.
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit

DIAGNOSTIC_DETAIL_LIMIT = 320

_URL = re.compile(r"https?://[^\s),;]+", re.IGNORECASE)
_BEARER = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]+=*", re.IGNORECASE)
# The label may be decorated. `\b` never fires inside `client_secret` because
# `_` is a word character. Over-redacting a log line costs nothing; leaking one
# costs everything, so any token-ish label matches however it is dressed.
_SECRET = re.compile(
    r"([A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?token|client[_-]?secret"
    r"|token|secret|key|authorization|cookie|password)[A-Za-z0-9_-]*)"
    r"\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)",
    re.IGNORECASE,
)
_PAYLOAD = re.compile(r"\b(body|payload|response)\b\s*[:=]\s*.+$", re.IGNORECASE)
_QUOTED = re.compile(r"\"[^\"]*\"")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")


def _redact_url(match: "re.Match[str]") -> str:
    """Keep scheme, host and path; drop userinfo and the whole query string."""
    try:
        parsed = urlsplit(match.group(0))
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return "[redacted-url]"
    if not hostname:
        return "[redacted-url]"
    host = f"[{hostname}]" if ":" in hostname and not hostname.startswith("[") else hostname
    netloc = f"{host}:{port}" if port is not None else host
    suffix = "?[redacted]" if parsed.query else ""
    return f"{parsed.scheme}://{netloc}{parsed.path}{suffix}"


def bounded_diagnostic_detail(error: object, limit: int = DIAGNOSTIC_DETAIL_LIMIT) -> str:
    """Return a bounded, redacted `Name: message` for logs and attempt shards."""
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= DIAGNOSTIC_DETAIL_LIMIT:
        raise ValueError(f"diagnostic detail limit must be within 1..{DIAGNOSTIC_DETAIL_LIMIT}")
    # `None` keeps the contract the pre-existing copies already had: callers
    # decide whether to attach a detail, and a helper that returns "" for a
    # missing error would quietly change what those callers emit.
    if error is None:
        return "unknown error"
    if isinstance(error, BaseException):
        name = re.sub(r"[^A-Za-z0-9_.-]", "", type(error).__name__) or "Error"
        message = str(error)
    else:
        name = ""
        message = str(error)
    message = " ".join(_CONTROL.sub(" ", message).split())
    message = _URL.sub(_redact_url, message)
    message = _BEARER.sub("Bearer [redacted]", message)
    message = _SECRET.sub(r"\1=[redacted]", message)
    message = _PAYLOAD.sub(r"\1: [redacted]", message)
    # A decode failure quotes the provider body back at us; the quoted run is
    # payload, not diagnosis.
    if name == "JSONDecodeError" or name.endswith("SyntaxError"):
        message = _QUOTED.sub('"[redacted]"', message)
    detail = f"{name}: {message or 'no message'}" if name else (message or "unknown error")
    return detail[:limit]
