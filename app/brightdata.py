"""Thin Bright Data client: Google results through the SERP API, public Instagram posts through the Web Scraper API.

Routes follow the Cal Hacks hackpack (ScrapeAlchemist/public-data-hackpack, AGENTS.md and
ideas/06-influencer-crm), which measured them on 2026-10-19:
- Google: POST /request with `brd_json=1` in the Google URL returns JSON with `organic[]`.
  It sometimes answers 200 with an empty body (`x-brd-error-code: captcha`) or non-JSON text,
  so those count as failed attempts and are retried.
- Instagram posts: trigger a `discover_new` job, poll /progress, download /snapshot. Jobs take
  about 100 to 280 s. Error rows sit inside a 200, and a profile can come back with zero rows and
  no error, so zero-row profiles are retried once.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Callable, Optional
from urllib.parse import urlencode, urlsplit

import httpx

log = logging.getLogger(__name__)

API_BASE = "https://api.brightdata.com"
IG_POSTS_DATASET = "gd_lk5ns7kz21pck8jpis"
# Good Google answers took 8 to 15 s live (2026-10-23); blocked ones hung about 60 s, then came back
# empty with x-brd-error-code: expect_element. Cut slow attempts short and retry once: worst case ~42 s.
SERP_ATTEMPTS = 2
SERP_ATTEMPT_TIMEOUT_S = 20
IG_POLL_INTERVAL_S = 5
IG_MAX_WAIT_S = 300
IG_MIN_RETRY_S = 90  # only retry zero-row profiles if this much of the wait budget is left


class BrightDataError(Exception):
    """Any Bright Data failure we can't recover from."""


class BrightDataAuthError(BrightDataError):
    """API key missing, invalid, or not allowed to use the zone."""


class BrightDataTimeout(BrightDataError):
    """Bright Data didn't finish in time."""


@dataclass
class SerpResult:
    rank: int
    title: str
    link: str
    description: str


@dataclass
class IgPost:
    url: str
    handle: Optional[str]
    caption: str
    posted_at: Optional[datetime]  # UTC
    content_type: Optional[str] = None
    shortcode: Optional[str] = None
    profile_url: Optional[str] = None
    coauthors: list[str] = field(default_factory=list)  # collab posts: other accounts that co-published it


@dataclass
class InstagramResult:
    posts: list[IgPost]
    errors: list[str] = field(default_factory=list)


class RequestCounter:
    """Counts billable Bright Data calls for one API request (thread-safe; SERP queries run in parallel)."""

    def __init__(self) -> None:
        self.count = 0
        self._lock = threading.Lock()

    def add(self) -> None:
        with self._lock:
            self.count += 1


def profile_key(url: str) -> str:
    """'https://www.instagram.com/Milksha_CA/' -> 'milksha_ca'."""
    return urlsplit(url).path.strip("/").split("/")[0].lower()


def _brd_error(resp: httpx.Response) -> str:
    code = resp.headers.get("x-brd-error-code") or resp.headers.get("x-brd-error")
    return f" ({code})" if code else ""


def _json_body(text: str) -> Optional[dict[str, Any]]:
    """The parsed Google page, whether it arrives as an object, a JSON string, or wrapped in 'body'."""
    try:
        data: Any = json.loads(text)
        if isinstance(data, str):
            data = json.loads(data)
        if isinstance(data, dict) and "organic" not in data and isinstance(data.get("body"), str):
            data = json.loads(data["body"])
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def _parse_posted(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class BrightDataClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        zone: Optional[str] = None,
        http: Optional[httpx.Client] = None,
        timeout: float = 60,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        poll_interval: float = IG_POLL_INTERVAL_S,
        retry_wait: float = 2,
        serp_timeout: float = SERP_ATTEMPT_TIMEOUT_S,
    ):
        self.api_key = api_key or os.getenv("BRIGHTDATA_API_KEY") or os.getenv("BRIGHTDATA_API_TOKEN")
        self._zone = zone or os.getenv("BRIGHTDATA_SERP_ZONE") or os.getenv("BRIGHTDATA_ZONE") or None
        self.http = http or httpx.Client(timeout=timeout)
        self.sleep = sleep
        self.clock = clock
        self.poll_interval = poll_interval
        self.retry_wait = retry_wait
        self.serp_timeout = serp_timeout
        self._zone_lock = threading.Lock()

    # --- plumbing -------------------------------------------------------------

    def require_key(self) -> None:
        if not self.api_key:
            raise BrightDataAuthError("BRIGHTDATA_API_KEY is not set")

    def _send(self, method: str, path: str, counter: Optional[RequestCounter] = None, **kw: Any) -> httpx.Response:
        self.require_key()
        if counter is not None:
            counter.add()
        resp = self.http.request(method, API_BASE + path, headers={"Authorization": f"Bearer {self.api_key}"}, **kw)
        if resp.status_code in (401, 403):
            raise BrightDataAuthError(f"Bright Data rejected the API key or zone: HTTP {resp.status_code}{_brd_error(resp)}")
        return resp

    def zone(self) -> str:
        """Zone for Google requests: env var, else the account's first serp or unblocker zone."""
        if self._zone:
            return self._zone
        with self._zone_lock:
            if not self._zone:
                resp = self._send("GET", "/zone/get_active_zones")
                if resp.status_code != 200:
                    raise BrightDataError(f"could not list Bright Data zones: HTTP {resp.status_code}")
                zones = [z for z in resp.json() if isinstance(z, dict)]
                for wanted in ("serp", "unblocker"):
                    match = next((z["name"] for z in zones if z.get("type") == wanted and z.get("name")), None)
                    if match:
                        self._zone = match
                        break
                else:
                    raise BrightDataError(
                        "no SERP or Web Unlocker zone on this Bright Data account; "
                        "create one in the control panel and set BRIGHTDATA_SERP_ZONE"
                    )
                log.info("using Bright Data zone %s", self._zone)
        return self._zone

    # --- Google ---------------------------------------------------------------

    def serp_search(self, query: str, past_month: bool = True, counter: Optional[RequestCounter] = None) -> list[SerpResult]:
        params = {"q": query, "hl": "en", "gl": "us", "brd_json": "1"}
        if past_month:
            params["tbs"] = "qdr:m"
        body = {"zone": self.zone(), "url": "https://www.google.com/search?" + urlencode(params), "format": "raw", "country": "us"}

        problem = ""
        timed_out = False
        for attempt in range(SERP_ATTEMPTS):
            if attempt:
                self.sleep(self.retry_wait * attempt)
            try:
                resp = self._send("POST", "/request", counter, json=body, timeout=self.serp_timeout)
            except httpx.TimeoutException:
                problem, timed_out = "timed out", True
                continue
            except httpx.TransportError as exc:
                problem, timed_out = f"network error ({exc.__class__.__name__})", False
                continue
            timed_out = False
            if resp.status_code == 429 or resp.status_code >= 500:
                problem = f"HTTP {resp.status_code}{_brd_error(resp)}"
                continue
            if resp.status_code >= 400:
                raise BrightDataError(f"Google search failed: HTTP {resp.status_code}{_brd_error(resp)}")
            data = _json_body(resp.text)
            if data is None:
                problem = f"empty or non-JSON response{_brd_error(resp)}"
                continue
            results = [
                SerpResult(
                    rank=int(item.get("rank") or item.get("global_rank") or i + 1),
                    title=str(item.get("title") or ""),
                    link=str(item["link"]),
                    description=str(item.get("description") or ""),
                )
                for i, item in enumerate(data.get("organic") or [])
                if isinstance(item, dict) and item.get("link")
            ]
            # Live 2026-10-24: the same query returned 8 of 8 undecodable "/goto?url=CAES..." links,
            # then 8 real links a few minutes later. A page of only redirects is a failed attempt.
            if results and not any(r.link.startswith(("http://", "https://")) for r in results):
                problem = "only Google redirect links (/goto?url=...)"
                continue
            return results

        message = f"Google search for {query!r} failed after {SERP_ATTEMPTS} attempts: {problem}"
        raise BrightDataTimeout(message) if timed_out else BrightDataError(message)

    # --- Instagram ------------------------------------------------------------

    def instagram_recent_posts(
        self,
        profile_urls: list[str],
        num_of_posts: int,
        since: date,
        max_wait_s: float = IG_MAX_WAIT_S,
        on_progress: Optional[Callable[[str], None]] = None,
        counter: Optional[RequestCounter] = None,
    ) -> InstagramResult:
        progress = on_progress or (lambda _msg: None)
        deadline = self.clock() + max_wait_s

        posts, errors, errored = self._posts_job(profile_urls, num_of_posts, since, deadline, progress, counter)

        def empty_profiles() -> list[str]:
            seen = {profile_key(p.profile_url) for p in posts if p.profile_url}
            seen |= {(p.handle or "").lower() for p in posts}
            return [u for u in profile_urls if profile_key(u) not in seen and profile_key(u) not in errored]

        # Bright Data sometimes returns zero rows for a profile with no error; a rerun usually fixes it.
        empty = empty_profiles()
        if empty and deadline - self.clock() >= IG_MIN_RETRY_S:
            progress(f"retrying {len(empty)} profile(s) that returned no posts")
            try:
                more, more_errors, more_errored = self._posts_job(empty, num_of_posts, since, deadline, progress, counter)
                posts += more
                errors += more_errors
                errored |= more_errored
            except BrightDataTimeout:
                errors.append("retry for profiles with no posts ran out of time")
        for url in empty_profiles():
            errors.append(f"@{profile_key(url)}: no public posts returned since {since.isoformat()}")

        # Pinned posts come back regardless of start_date; keep only the window we asked for.
        recent = [p for p in posts if p.posted_at is None or p.posted_at.date() >= since]
        if len(recent) < len(posts):
            progress(f"dropped {len(posts) - len(recent)} post(s) older than {since.isoformat()} (pinned)")
        return InstagramResult(posts=recent, errors=errors)

    def instagram_posts(
        self,
        post_urls: list[str],
        max_wait_s: float = IG_MAX_WAIT_S,
        on_progress: Optional[Callable[[str], None]] = None,
        counter: Optional[RequestCounter] = None,
    ) -> InstagramResult:
        """Fetch specific public posts by URL (sync /scrape). Live, one post took 10 s.

        Unlike discovery by profile, this works when Google has already found the post URLs.
        If the scrape runs past about a minute, Bright Data answers 202 with a snapshot_id; then poll.
        """
        progress = on_progress or (lambda _msg: None)
        deadline = self.clock() + max_wait_s
        started = self.clock()
        params = {"dataset_id": IG_POSTS_DATASET, "format": "json", "include_errors": "true"}
        try:
            resp = self._send(
                "POST", "/datasets/v3/scrape", counter, params=params,
                json={"input": [{"url": u} for u in post_urls]}, timeout=max(max_wait_s, 1),
            )
        except httpx.TimeoutException:
            raise BrightDataTimeout(f"Instagram post fetch timed out after {int(self.clock() - started)}s")
        if resp.status_code >= 400:
            raise BrightDataError(f"Instagram post fetch failed: HTTP {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        note = None
        if resp.status_code == 202 or (isinstance(data, dict) and set(data) <= {"snapshot_id", "message"} and data.get("snapshot_id")):
            snapshot_id = data["snapshot_id"]
            progress(f"post fetch still running; polling Bright Data snapshot {snapshot_id}")
            rows, note = self._wait_and_download(snapshot_id, started, deadline, progress)
        else:
            rows = data if isinstance(data, list) else [data]
        posts, errors, _ = _parse_rows(rows)
        if not posts and note:
            errors.append(f"Bright Data: {note}")
        progress(f"fetched {len(posts)} of {len(post_urls)} post(s) in {int(self.clock() - started)}s")
        return InstagramResult(posts=posts, errors=errors)

    def _posts_job(
        self,
        profile_urls: list[str],
        num_of_posts: int,
        since: date,
        deadline: float,
        progress: Callable[[str], None],
        counter: Optional[RequestCounter],
    ) -> tuple[list[IgPost], list[str], set[str]]:
        inputs = [
            {"url": u, "num_of_posts": num_of_posts, "start_date": since.strftime("%m-%d-%Y"), "post_type": "Post"}
            for u in profile_urls
        ]
        params = {"dataset_id": IG_POSTS_DATASET, "type": "discover_new", "discover_by": "url", "include_errors": "true"}
        resp = self._send("POST", "/datasets/v3/trigger", counter, params=params, json={"input": inputs})
        if resp.status_code >= 400:
            raise BrightDataError(f"Instagram job trigger failed: HTTP {resp.status_code}: {resp.text[:200]}")
        snapshot_id = (resp.json() or {}).get("snapshot_id")
        if not snapshot_id:
            raise BrightDataError("Instagram job trigger returned no snapshot_id")
        started = self.clock()
        progress(f"started Bright Data job {snapshot_id} for {len(profile_urls)} profile(s)")
        rows, note = self._wait_and_download(snapshot_id, started, deadline, progress)
        posts, errors, errored = _parse_rows(rows)
        if not posts and note:
            errors.append(f"Bright Data job {snapshot_id}: {note}")
        progress(f"downloaded {len(posts)} post(s) in {int(self.clock() - started)}s")
        return posts, errors, errored

    def _wait_and_download(
        self, snapshot_id: str, started: float, deadline: float, progress: Callable[[str], None]
    ) -> tuple[list[Any], Optional[str]]:
        """Poll /progress until ready, then download the snapshot. Returns (rows, Bright Data's message, if any)."""

        def wait_or_timeout(what: str) -> None:
            if self.clock() + self.poll_interval > deadline:
                raise BrightDataTimeout(f"Instagram job {snapshot_id} {what} after {int(self.clock() - started)}s")
            self.sleep(self.poll_interval)

        last_status = None
        while True:
            try:
                status_resp = self._send("GET", f"/datasets/v3/progress/{snapshot_id}")
                info = status_resp.json() if status_resp.status_code == 200 else {}
            except (httpx.TransportError, ValueError):
                info = {}  # transient; keep polling until the deadline
            status = info.get("status")
            if status == "ready":
                break
            if status in ("failed", "canceled"):
                raise BrightDataError(f"Instagram job {status}: {info.get('error_message') or 'no reason given'}")
            if status and status != last_status:
                progress(f"job {status} ({int(self.clock() - started)}s)")
                last_status = status
            wait_or_timeout("was not ready")

        while True:
            snap = self._send("GET", f"/datasets/v3/snapshot/{snapshot_id}", params={"format": "json"})
            if snap.status_code == 202:
                wait_or_timeout("snapshot was not downloadable")
                continue
            if snap.status_code >= 400:
                raise BrightDataError(f"Instagram snapshot download failed: HTTP {snap.status_code}")
            rows = snap.json()
            break

        if not isinstance(rows, list):
            raise BrightDataError("Instagram snapshot was not a list of records")
        # Live 2026-10-23: an empty snapshot came with "No records found. The data may not be available..."
        return rows, info.get("error_message")


_POST_PATH = re.compile(r"^/(?:[^/]+/)?(?:p|reel|tv)/([^/]+)")


def ig_shortcode(url: str) -> Optional[str]:
    """'https://www.instagram.com/reel/DeFYcA0gU6G/?igsh=x' -> 'DeFYcA0gU6G'; None for profiles and other pages.

    Posts are matched by shortcode because the scraper may answer /p/X for a requested /reel/X.
    """
    parts = urlsplit(url)
    host = (parts.hostname or "").lower().removeprefix("www.")
    if host != "instagram.com":
        return None
    m = _POST_PATH.match(parts.path)
    return m.group(1) if m else None


def _is_post_url(url: str) -> bool:
    return ig_shortcode(url) is not None


def _parse_rows(rows: list[Any]) -> tuple[list[IgPost], list[str], set[str]]:
    """Posts, error messages, and the profile keys of inputs that errored. Errors arrive inside a 200."""
    posts: list[IgPost] = []
    errors: list[str] = []
    errored: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        if row.get("error") or row.get("error_code"):
            url = (row.get("input") or {}).get("url") or "?"
            label = url if _is_post_url(url) else f"@{profile_key(url)}"
            errored.add(profile_key(url))
            errors.append(f"{label}: {row.get('error_code') or 'error'}: {row.get('error') or ''}".rstrip(": "))
            continue
        if not row.get("url"):
            continue
        posts.append(
            IgPost(
                url=row["url"],
                handle=row.get("user_posted"),
                caption=row.get("description") or "",
                posted_at=_parse_posted(row.get("date_posted")),
                content_type=row.get("content_type"),
                shortcode=row.get("shortcode"),
                profile_url=(row.get("discovery_input") or {}).get("url"),
                coauthors=[c for c in (row.get("coauthor_producers") or []) if isinstance(c, str)],
            )
        )
    return posts, errors, errored
