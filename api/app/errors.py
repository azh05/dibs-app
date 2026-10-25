"""Map upstream failures to HTTP status codes, shared by the endpoints and background jobs."""
from __future__ import annotations

from typing import Optional

import anthropic

from .apify import ApifyAuthError, ApifyError, ApifyTimeout
from .brightdata import BrightDataAuthError, BrightDataError, BrightDataTimeout
from .elastic import ElasticAuthError, ElasticError, ElasticNotConfigured
from .push import PushError


class AnthropicKeyMissing(RuntimeError):
    """No ANTHROPIC_API_KEY. The SDK only notices at request time, with a bare TypeError."""


def http_error(exc: Exception) -> Optional[tuple[int, str]]:
    """(status_code, detail) for errors we expect, None for bugs."""
    if isinstance(exc, AnthropicKeyMissing):
        return 500, "ANTHROPIC_API_KEY is missing or invalid"
    if isinstance(exc, BrightDataAuthError):
        return 500, "BRIGHTDATA_API_KEY missing or invalid"
    if isinstance(exc, BrightDataTimeout):
        return 504, f"Bright Data timed out: {exc}"
    if isinstance(exc, BrightDataError):
        return 502, f"Bright Data error: {exc}"
    if isinstance(exc, ApifyAuthError):
        return 500, "APIFY_TOKEN missing or invalid"
    if isinstance(exc, ApifyTimeout):
        return 504, f"Apify timed out: {exc}"
    if isinstance(exc, ApifyError):
        return 502, f"Apify error: {exc}"
    if isinstance(exc, ElasticNotConfigured):
        return 503, str(exc)
    if isinstance(exc, ElasticAuthError):
        return 500, "ELASTIC_API_KEY missing or invalid"
    if isinstance(exc, ElasticError):
        return 502, f"Elastic error: {exc}"
    if isinstance(exc, PushError):
        return 502, f"Expo push error: {exc}"
    if isinstance(exc, anthropic.AuthenticationError):
        return 500, "ANTHROPIC_API_KEY is missing or invalid"
    if isinstance(exc, anthropic.RateLimitError):
        return 429, "Claude rate limit hit; retry shortly"
    if isinstance(exc, anthropic.APIError):
        return 502, f"Claude API error: {exc}"
    return None
