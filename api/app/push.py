"""Expo push notifications for watch matches (the dibs-watch-matcher workflow calls POST /alerts/push).
Same text as the app's local alerts (app/src/lib/notifications.ts `alertBody`): store, then the deal and when it ends."""
from __future__ import annotations

from typing import Optional

import httpx

from .schemas import Deal

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


class PushError(Exception):
    """Expo rejected the push or couldn't be reached."""


def _clock(hour: int, minute: int) -> str:
    suffix = "AM" if hour < 12 else "PM"
    h = hour % 12 or 12
    return f"{h} {suffix}" if minute == 0 else f"{h}:{minute:02d} {suffix}"


def when_line(deal: Deal) -> str:
    """'Ends Oct 24, 6 PM', 'Ends Oct 24', or 'Live now' without an end date."""
    if not deal.end_date:
        return "Live now"
    day = f"{MONTHS[deal.end_date.month - 1]} {deal.end_date.day}"
    if deal.end_time:
        return f"Ends {day}, {_clock(deal.end_time.hour, deal.end_time.minute)}"
    return f"Ends {day}"


def message(token: str, deal: Deal) -> dict:
    return {
        "to": token,
        "title": deal.shop_name,
        "body": f"{deal.offer}\n{when_line(deal)}",
        "data": {"dealId": deal.id},
        "sound": "default",
    }


class ExpoPush:
    def __init__(self, http: Optional[httpx.Client] = None):
        self.http = http or httpx.Client(timeout=20)

    def send(self, token: str, deals: list[Deal]) -> int:
        if not deals:
            return 0
        try:
            resp = self.http.post(EXPO_PUSH_URL, json=[message(token, d) for d in deals])
        except httpx.HTTPError as exc:
            raise PushError(str(exc)) from exc
        if resp.status_code >= 400:
            raise PushError(f"Expo {resp.status_code}: {resp.text[:200]}")
        tickets = resp.json().get("data", [])
        return sum(1 for t in tickets if t.get("status") == "ok")
