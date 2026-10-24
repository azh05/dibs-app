"""Map upstream failures to HTTP status codes, shared by the endpoints and background jobs."""
from __future__ import annotations

from typing import Optional

import anthropic

from .brightdata import BrightDataAuthError, BrightDataError, BrightDataTimeout


def http_error(exc: Exception) -> Optional[tuple[int, str]]:
    """(status_code, detail) for errors we expect, None for bugs."""
    if isinstance(exc, BrightDataAuthError):
        return 500, "BRIGHTDATA_API_KEY missing or invalid"
    if isinstance(exc, BrightDataTimeout):
        return 504, f"Bright Data timed out: {exc}"
    if isinstance(exc, BrightDataError):
        return 502, f"Bright Data error: {exc}"
    if isinstance(exc, anthropic.AuthenticationError):
        return 500, "ANTHROPIC_API_KEY is missing or invalid"
    if isinstance(exc, anthropic.RateLimitError):
        return 429, "Claude rate limit hit; retry shortly"
    if isinstance(exc, anthropic.APIError):
        return 502, f"Claude API error: {exc}"
    return None
