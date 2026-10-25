"""User photo of an in-store deal (poster, window sign, menu board) -> verified deal JSON.

Claude reads the image and transcribes every word; verify.py then checks each deal's quote against that
transcript, the same way the Bright Data pipelines check quotes against fetched pages.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
from datetime import date
from typing import Any, Optional

import anthropic
from pydantic import Field

from .errors import AnthropicKeyMissing
from .extractor import DEAL_RULES, DEAL_TYPES, DEFAULT_MODEL, _inline_refs, _parse_raw_deals
from .schemas import RawDeal, SearchResponse, SearchResultSource, Usage
from .linking import link_deals
from .verify import normalize_url, verify_deals

log = logging.getLogger(__name__)

PHOTO_TOOL_NAME = "record_photo_deals"
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # Claude's per-image limit
PHOTO_URL_BASE = "https://dibs.local/photo/"
_FEB_29 = re.compile(r"^\d{4}-02-29$")

_MAGIC = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)

PHOTO_PROMPT = (
    DEAL_TYPES
    + """
You don't search. The user photographed a deal in person: a poster, window sign, flyer, or menu board. \
Read the image and record the deals it shows.

How to work:
- First transcribe every piece of readable text in the image, top to bottom, exactly as written \
(including fine print). Put it in `transcript`. Text only: no descriptions or notes of your own.
- source_url must be exactly the photo URL given in the user message.
- verbatim_quote must be copied word for word from your transcript. It is checked by machine.
- Dates: if the image shows a date without a year (e.g. "July 6th"), write it as YYYY-MM-DD using the \
photo's year and set year_stated to false. We correct the year afterwards. If no date is shown, use null.
- Times: start_time and end_time as HH:MM in 24-hour time, only if shown. "3PM to close" is start_time \
15:00, end_time null, and "until close" in conditions.
- A one-day event has the same start_date and end_date.
- Leave source_post_date null.
- shop_name: the brand or store shown. If none is visible, use the shop hint, else "Unknown". \
shop_handle only if an @handle is printed in the image.
- Confidence is about how clearly the image shows the offer, not about whether it is still running: \
dates are checked by machine. A missing year or a past date is not a reason for "low". Use "low" \
when the photo is blurry, cut off, or the offer is ambiguous.
- If the image is not a deal at all, or is unreadable, record no deals.
"""
    + DEAL_RULES
    + """
Call the record_photo_deals tool exactly once. If you found no deals, call it with an empty list.
"""
)


class PhotoRawDeal(RawDeal):
    year_stated: bool = Field(True, description="false if a date in the image is shown without a year")


def sniff_media_type(data: bytes) -> Optional[str]:
    """Media type from magic bytes, or None if it isn't an image Claude accepts."""
    for magic, media_type in _MAGIC:
        if data.startswith(magic):
            return media_type
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def photo_url(data: bytes) -> str:
    return PHOTO_URL_BASE + hashlib.sha256(data).hexdigest()[:16]


def resolve_missing_year(d: date, ref: date) -> date:
    """The occurrence of d's month and day nearest ref. Looks up to 4 years each way so Feb 29 finds a leap year."""
    candidates = []
    for year in range(ref.year - 4, ref.year + 5):
        try:
            candidates.append(d.replace(year=year))
        except ValueError:  # Feb 29 in a non-leap year
            pass
    return min(candidates, key=lambda c: abs((c - ref).days)) if candidates else d


def photo_tool_definition() -> dict[str, Any]:
    deal_schema = _inline_refs(PhotoRawDeal.model_json_schema())
    return {
        "name": PHOTO_TOOL_NAME,
        "description": "Record the image transcript and every deal it shows. Call exactly once.",
        "input_schema": {
            "type": "object",
            "properties": {
                "transcript": {"type": "string", "description": "All readable text in the image, top to bottom"},
                "deals": {"type": "array", "items": deal_schema},
            },
            "required": ["transcript", "deals"],
        },
    }


def _hold_feb_29(items: list[Any]) -> list[Any]:
    """A yearless Feb 29 written with a non-leap photo year (2027-02-29) would fail validation and be
    cleared. Park it in a leap year; resolve_missing_year replaces the year afterwards."""
    out = []
    for item in items:
        if isinstance(item, dict) and item.get("year_stated") is False:
            item = {**item, **{f: "2000-02-29" for f in ("start_date", "end_date") if _FEB_29.match(str(item.get(f) or ""))}}
        out.append(item)
    return out


class PhotoExtractor:
    def __init__(self, client: Optional[anthropic.Anthropic] = None, model: str = DEFAULT_MODEL):
        self._client = client
        self.model = model

    @property
    def client(self) -> Any:
        if self._client is None:
            if not os.getenv("ANTHROPIC_API_KEY"):
                raise AnthropicKeyMissing()
            self._client = anthropic.Anthropic()
        return self._client

    def extract(
        self,
        data: bytes,
        media_type: str,
        photo_date: date,
        shop: Optional[str] = None,
        filename: Optional[str] = None,
        today: Optional[date] = None,
    ) -> SearchResponse:
        """photo_date anchors missing years and counts as the post date; status is judged against today."""
        today = today or photo_date
        url = photo_url(data)
        context = f"Photo URL: {url}\nPhoto taken on {photo_date.isoformat()}."
        if shop:
            context += f"\nShop hint from the user: {shop}."
        messages: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(data).decode()}},
                    {"type": "text", "text": context},
                ],
            }
        ]
        usage = Usage()
        errors: list[str] = []
        recorded: Optional[dict[str, Any]] = None
        # Same shape as bd_pipeline.extract_from_docs: tool_choice auto plus one nudge, since
        # claude-opus-5-5 rejects a forced tool_choice.
        for attempt in range(2):
            resp = self.client.messages.create(
                model=self.model,
                max_tokens=8000,
                system=PHOTO_PROMPT,
                tools=[photo_tool_definition()],
                tool_choice={"type": "auto"},
                messages=messages,
            )
            usage.input_tokens += getattr(resp.usage, "input_tokens", 0) or 0
            usage.output_tokens += getattr(resp.usage, "output_tokens", 0) or 0
            call = next((b for b in resp.content if b.type == "tool_use" and b.name == PHOTO_TOOL_NAME), None)
            if call is not None:
                if resp.stop_reason == "max_tokens":
                    errors.append("Claude hit max_tokens; some deals may be missing")
                recorded = call.input or {}
                break
            if resp.stop_reason == "max_tokens" or attempt:
                break
            messages.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in resp.content]})
            messages.append({"role": "user", "content": "Now call record_photo_deals with the transcript and every deal, or an empty list."})
        if recorded is None:
            errors.append("Claude never called record_photo_deals")
            recorded = {}

        transcript = recorded.get("transcript") or ""
        raw = _parse_raw_deals(_hold_feb_29(recorded.get("deals") or []), errors, model=PhotoRawDeal)

        fixed: list[RawDeal] = []
        preset_flags: list[list[str]] = []
        for deal in raw:
            updates: dict[str, Any] = {"source_post_date": photo_date}
            if not getattr(deal, "year_stated", True) and (deal.start_date or deal.end_date):
                start = resolve_missing_year(deal.start_date, photo_date) if deal.start_date else None
                end = resolve_missing_year(deal.end_date, photo_date) if deal.end_date else None
                if start and end and end < start:  # e.g. Dec 28 - Jan 3: the end is in the next year
                    try:
                        end = end.replace(year=end.year + 1)
                    except ValueError:
                        pass
                updates.update(start_date=start, end_date=end)
                preset_flags.append(["year_inferred"])
            else:
                preset_flags.append([])
            fixed.append(RawDeal.model_validate({**deal.model_dump(exclude={"year_stated"}), **updates}))

        source = SearchResultSource(url=url, title=filename, text=transcript, origin="photo")
        deals, rejected = verify_deals(
            fixed, [source], today, source_texts={normalize_url(url): transcript}, preset_flags=preset_flags
        )
        shops = link_deals(deals, [], [])

        return SearchResponse(
            as_of=today,
            deals=deals,
            rejected=rejected,
            queries=[],
            sources=[source],
            search_errors=errors,
            usage=usage,
            provider="user_photo",
            transcript=transcript,
            shops=shops,
        )
