# Dibs API

Finds short-lived local deals, returns them as structured JSON, and checks each one with plain Python rules before anyone sees it. Three ways to fetch: Claude's own web search (`/extract/search`); Bright Data public web data (`/extract/serp` for Google results, `/extract/instagram` for shops' public posts); or Apify (`/extract/shops`: find shops on Google Maps, then scrape each one's website, Instagram, TikTok and Facebook). With Bright Data and Apify, Claude only extracts. Users can also upload a photo of an in-store deal (`/extract/photo`).

## Run it

Needs [uv](https://docs.astral.sh/uv/). It installs Python 3.13 and the dependencies for you. From the repo root:

```bash
cd api                                     # every command below runs from here
uv sync
cp .env.example .env                       # then add ANTHROPIC_API_KEY (+ BRIGHTDATA_API_KEY, APIFY_TOKEN: see the setup sections)
uv run --env-file .env uvicorn app.main:app --reload --port 8000
```

Interactive docs: http://localhost:8000/docs

```bash
curl -s -X POST localhost:8000/extract/search \
  -H 'content-type: application/json' \
  -d '{
        "location": {"neighborhood": "Westwood", "city": "Los Angeles", "region": "California"},
        "radius_miles": 1,
        "categories": ["drink", "food"],
        "max_searches": 5
      }' | python -m json.tool
```

Other request fields: `shop` ("Milksha Westwood"), `query` ("boba BOGO"), `allowed_domains` (["instagram.com"]).

**Auth.** Set `DIBS_API_KEY` in `.env` and every `/extract/*` call needs the header `X-Dibs-Key: <key>` (401 otherwise); `/health`, `/docs` and `/demo` stay open. The Convex backend sends it on every call. Left blank, the API is open, which is fine only on 127.0.0.1 (the `/demo` page relies on that).

## How it works

1. **One Claude call, two tools.** `web_search` (server-side, capped by `max_searches`, located to the request's city) and `record_deals`, a client tool whose input schema is the deal JSON. Claude searches, then calls `record_deals` once.
   - `pause_turn` → the assistant turn is sent back unchanged and Claude continues.
   - Plain-text answer → one follow-up turn asks for `record_deals`. (`tool_choice` stays `auto`: forcing a tool returns a 400 on `claude-opus-5-5`.)
   - Gives up after 4 turns and reports it in `search_errors`.
2. **Per-deal validation.** A date Claude can't express as `YYYY-MM-DD` becomes `null`, never a guess. Other bad fields drop that one deal, not the batch.
3. **Verification** (`app/verify.py`, no AI):

| Rule | Result |
| --- | --- |
| No verbatim quote | rejected: `missing_quote` |
| `source_url` isn't a URL the search returned | rejected: `source_not_in_search_results` |
| Promo code not in the quote | code removed, flag `code_not_in_quote` |
| No post date from Claude | uses the search result's `page_age`, flag `post_date_from_page_age` |
| End date passed | `expired` |
| End date in the future | `live` |
| No end date, post over 14 days old | `stale`, flag `no_end_date` |
| No end date, recent post | `live`, flag `no_end_date` |
| No dates at all | `needs_check`, flag `no_dates` |
| Confidence `low` | never `live`; `needs_check`, flag `low_confidence` |
| Same shop + offer + code | deduped, newest post kept |

Deals come back sorted live → needs_check → stale → expired.

**Sources.** Each source carries the full `text` we read (caption, snippet, page or photo transcript), its `origin` (`serp`, `instagram`, `tiktok`, `facebook`, `website`, `photo`) and the posting account's `handle`, so a database can store what each deal was checked against. `/extract/search` has no text (Claude's web search results are encrypted).

**Display fields.** Claude also fills these for the app. They are never verified and never affect status; a malformed value is cleared (or a long one shortened), not fatal to the deal.

| Field | Meaning |
| --- | --- |
| `headline` | Map-pin text, at most 12 characters: "BOGO", "30% off", "$9" |
| `title` | Short name, at most 40 characters: "BOGO on all milk teas" |
| `deal_types` | Any of `bogo`, `percent_off`, `free`, `student`, `happy_hour`, `late_night`, `new_opening`, `event` (the app's "Deal types" chips) |
| `kind` | `deal`, or `event` for a dated pop-up, collab or opening party (the app's "Coming up") |
| `student_only`, `age_21` | Student ID / .edu required; 21+ only |
| `est_savings_cents` | What one person saves using it once, only when the source states prices; else null |
| `recurring_window` | `{days, start_time, end_time}` for deals that repeat, e.g. weekday happy hour |

## Response

```json
{
  "as_of": "2026-10-23",
  "deals": [{
    "shop_name": "Milksha Westwood", "shop_handle": "milksha_ca", "address": "1009 Broxton Ave",
    "category": "drink", "offer": "Buy 1 drink, get the 2nd 50% off", "code": "BOGO50",
    "conditions": ["in-store only"], "start_date": null, "end_date": "2026-10-31",
    "start_time": null, "end_time": null,
    "source_url": "https://www.instagram.com/p/...", "source_post_date": "2026-10-01",
    "verbatim_quote": "Buy 1 drink and get the second 50% off...", "confidence": "high",
    "headline": "BOGO 50%", "title": "2nd drink half off", "deal_types": ["bogo", "percent_off"],
    "kind": "deal", "student_only": false, "age_21": false, "est_savings_cents": 325, "recurring_window": null,
    "status": "live", "flags": [], "id": "deal:3f9c0a1b2c3d4e5f", "shop_id": "ig:milksha_ca"
  }],
  "shops": [{"id": "ig:milksha_ca", "name": "Milksha Westwood", "instagram": "milksha_ca", "found_via": "deal", "...": "..."}],
  "rejected": [{"deal": {"...": "..."}, "reason": "source_not_in_search_results"}],
  "queries": ["Westwood boba deal October", "..."],
  "sources": [{"url": "...", "title": "...", "page_age": "October 1, 2026", "text": "full caption or page text", "origin": "instagram", "handle": "milksha_ca"}],
  "search_errors": [],
  "usage": {"input_tokens": 0, "output_tokens": 0, "web_search_requests": 0},
  "provider": "claude_web_search",
  "brightdata_requests": 0
}
```

## Bright Data pipelines

Bright Data fetches the pages; Claude only extracts from them (no web search tool; one `record_deals` call over numbered sources `[S1]`, `[S2]`..., with one nudge turn if Claude answers in prose). Because we hold each source's full text, verification is stricter than on `/extract/search`:

| Extra rule | Result |
| --- | --- |
| Quote isn't in the source text (case, spacing and curly quotes ignored) | rejected: `quote_not_in_source` |
| Instagram post date differs from what Claude read | Bright Data's `date_posted` wins, flag `post_date_from_source` |

All the rules in the table above still apply. Instagram posts are first-hand only if the shop posted or co-posted them (collab posts list the shop in `coauthor_producers`); posts by other accounts that only mention the shop are rated low confidence, so they never show as `live`.

### `POST /extract/serp` (blocking, 10 to 60 s)

Bright Data SERP API, queries run in parallel. Body: `location`, `radius_miles`, `categories`, `shop`, `query`, `queries` (your own Google queries), `max_queries` (default 4, max 8), `past_month` (default true, adds `tbs=qdr:m`), `enrich_instagram` (default true). Automatic queries, where `{area}` is "neighborhood city" (plain "Westwood" also matches Westwood NJ, MA and KS): `{shop} promo code` (if `shop`), `site:instagram.com {area} deal`, `{area} grand opening special`, `{area} {category} BOGO`.

Checked live on 2026-10-23 and 10-24:
- Bright Data returns the parsed Google page as a JSON object (`organic[]` items have `title, link, description, global_rank`).
- `tbs=qdr:m` passes through: with it, every snippet was from Sep to Oct 2026; without it, results went back to May 2025.
- Good answers take 2 to 15 s. Blocked ones hang about 60 s and come back empty (`x-brd-error-code: expect_element`), or fail with `failed_query_rejected` or a 502. Each attempt is cut off at 20 s and retried once, so a dead query costs about 42 s, and queries run in parallel.
- Some results are undecodable Google redirects (`/goto?url=...`), and `site:` is sometimes ignored. Both are dropped and counted in `search_errors`. A page of only redirects counts as a failed attempt and is retried: the same query returned 8 of 8 redirects, then 8 real links minutes later.
- Many snippets start with a date ("Oct 15, 2026 — ...", "6 days ago — ..."). It is used as a fallback post date, the same as `page_age` on `/extract/search`. Instagram snippets carry none.

**Enrich (`enrich_instagram`).** Google snippets are cut off and undated. When a deal cites an Instagram post, the full post is fetched by URL (Instagram posts scraper, sync `/scrape`, 5 to 15 s live) and the deal is re-extracted from the full caption with the real post date. The snippet version is replaced, and the deal gets the flag `full_post_fetched`. Up to 5 posts per call. If the fetch fails, the snippet deals are kept and the failure is noted.

### `POST /extract/instagram` (background job, usually 20 to 60 s)

Google finds recent posts that mention each shop (`site:instagram.com "{handle}"`), then the Bright Data Instagram posts scraper (`gd_lk5ns7kz21pck8jpis`) fetches those posts by URL. Public, logged-out posts only; no comments or follower data. Body: `handles` (1 to 20, `@name`, `name` or profile URL), `num_of_posts` (default 6, max 20), `since_days` (default 30), `location`. Returns `202 {"job_id", "status_url"}`; poll `GET /extract/instagram/{job_id}` until `status` is `done` (with `result`) or `failed` (with `error.status_code`). Jobs live in memory and are lost on restart.

Each shop's own posts (including collab posts it co-authored) are used first. A shop's captions rarely contain its own handle, so Google mostly finds other accounts tagging it; if a shop has no posts of its own in the results, those tagging posts are used as second-hand sources. Shops with nothing at all fall back to Bright Data profile discovery (`discover_new`, 1 to 5 min). On 2026-10-23 and 10-24 discovery returned "No records found" on 6 of 6 jobs, for every account including `natgeo`, so it is a last resort; its message is passed through to `search_errors`.

Also handled: error rows inside a 200 are reported in `search_errors`, posts older than `since_days` are dropped, and UTC timestamps are converted to the shop's local date.

Live, 2026-10-24: `{"handles": ["26vietcafe.usa"]}` found 5 posts on Google, fetched all 5 in 15 s, and returned the soft-opening BOGO (Oct 17 to 25) as `live`, high confidence, from a collab post the cafe co-authored. 2 Bright Data requests.

Both return the usual response plus `provider` (`claude_web_search`, `brightdata_serp`, `brightdata_instagram`) and `brightdata_requests` (billable calls: SERP attempts including retries, post fetches, Instagram job triggers). No results is a 200 with `deals: []` and a note in `search_errors`.

| Error | HTTP |
| --- | --- |
| Bright Data key missing or rejected | 500 `BRIGHTDATA_API_KEY missing or invalid` |
| Bright Data timed out | 504 |
| Other Bright Data failure (every SERP query failed, job `failed`, ...) | 502 |
| One of several SERP queries failed | 200, noted in `search_errors` |

## Apify shop scraping

### `POST /extract/shops` (background job, 1 to 5 min)

Finds the shops in an area, then reads each shop's **own** channels, where deals actually get posted. Returns `202 {"job_id", "status_url"}`; poll `GET /extract/shops/{job_id}` the same way as the Instagram job.

1. **Shops.** Apify Google Maps scraper (`compass/crawler-google-places`) searches the area for each search term, with `scrapeContacts` on, so every shop comes back with the Instagram, TikTok and Facebook links from its listing or website. The list is cached per area for 7 days in `api/.cache/shops.json` (gitignored), so repeat runs skip this step; `refresh_shops: true` searches again. `DIBS_SHOP_CACHE=off` turns the cache off, or set it to another file path.
2. **Keyword sweep** (same time as step 1): a TikTok search per search term (`{neighborhood} {term} deal`, first 3 terms) and Instagram hashtags (`#{neighborhood}eats`, `food`, `deals`, plus one per term, e.g. `#westwoodboba`). Posts by other accounts are kept as second-hand sources. Accounts they @mention in recent posts that aren't already shops (up to 15) are scraped in step 3 too, as shops with `found_via: "mention"`.
3. **Google, through Bright Data** (when `BRIGHTDATA_API_KEY` is set; `google: false` turns it off). Two parts:
   - *Missing accounts:* for each Maps shop missing an Instagram, TikTok or Facebook link, one Google search (`"<name>" <city> instagram tiktok`). A `facebook.com/<page>` or `tiktok.com/@<handle>` link, or an `@handle` in a snippet, is taken only when it matches the shop's name (`juicecrafters` = "Juice Crafters"; neighborhood and city words in the name are optional, so `milksha_ca` = "Milksha Westwood"). Found accounts are saved with the cached shop list.
   - *Deal search* (alongside step 1): `site:instagram.com {area} {term} deal` and `{area} {term} deal`, past month, for the first 2 terms. Instagram posts in the results (up to 10) are fetched in full by Bright Data's Instagram scraper and treated like any post (the shop's own when its account posted them). Other results (Yelp, Reddit, Daily Bruin...) stay as Google snippets: second-hand, shown to Claude last.
   - Any Bright Data failure, including a rejected key, is noted in `search_errors`; the Apify steps still run. `brightdata_requests` in the response counts the billable calls (about $0.0015 each).
4. **Channels**, one Apify run each, all shops at once, in parallel:

| Channel | Actor | What's read |
| --- | --- | --- |
| Instagram | `apify/instagram-scraper` | Newest posts and reels: caption + image alt text, post date, @mentions, collab coauthors |
| TikTok | `clockworks/tiktok-scraper` | Newest videos: caption, post date, @mentions (no speech-to-text yet) |
| Facebook | `apify/facebook-posts-scraper` | Newest page posts: text + **OCR of poster images** (`[image text] ...`), post date |
| Website | `apify/website-content-crawler` (adaptive: plain HTTP, or a browser for JS-built sites) | Home page + linked pages whose URL contains deal/special/promo/offer/happy/menu/event/news/student/discount/sale/coupon, up to 2 per site |

5. Claude extracts over all of it; sources are split into batches that each fit one call, run in parallel, so nothing is dropped. `verify_deals` checks the deals with the same rules as the Bright Data path.
6. Every deal is linked to a shop (see "Shops, deals and ids" below).

Body: `location`, `radius_miles`, `categories`, `search_terms` (Google Maps searches; default from `categories`, see below), `shops` (names to look up instead of searching, e.g. `["Milksha Westwood"]`), `max_shops` (default 20, max 60, split across the search terms), `days` (default 14), `posts_per_shop` (default 6), `channels` (default all four), `sweep` (default true), `hashtags`, `search_queries`, `refresh_shops`, `google` (default true).

| Category | Google Maps searches |
| --- | --- |
| `food` | restaurant, fast food, pizza, dessert |
| `drink` | boba, coffee shop, juice bar |
| `retail` | clothing store, thrift store, bookstore |
| `entertainment` | bowling alley, karaoke, movie theater |
| `beauty` | barbershop, hair salon, nail salon |
| `fitness` | gym, boxing gym, yoga studio |
| none given | food + drink |

Any other kind of shop works through `search_terms` (e.g. `["tattoo shop"]`); Claude is told which searches found the shops.

**First-hand vs second-hand.** A post is the shop's own when its author is the shop's account (Instagram also: a collab coauthor; Facebook: the page we asked for; website: the shop's domain). These are marked `shop's own <channel>` for Claude and the deal gets the flag `shop_own_post`. Everything else (sweep posts, influencers, food blogs) is still recorded, at most `medium` confidence when it names the shop and states a concrete offer (`low` when vague), and flagged `second_hand`, so the app can show it as less verified. A medium second-hand deal can be `live`.

Also handled: a failed channel is retried once, then noted in `search_errors` while the other channels still return (only a failed Google Maps search or a bad token fails the job); pinned posts older than `days` are dropped; long web pages show Claude only the deal-looking lines (with a line of context), but the quote is checked against the whole page.

The response adds `shops` and `apify_runs`; `provider` is `apify_shops`.

| Error | HTTP |
| --- | --- |
| `APIFY_TOKEN` missing or rejected | 500 `APIFY_TOKEN missing or invalid` (missing: before the job starts) |
| Apify run over 4 min (408, or 400 `TIMED-OUT`) | 504 for Google Maps; for a channel, noted in `search_errors` (not retried) |
| Google Maps search failed, out of credits (402), bad input | 502 |
| Account memory full (402 "memory limit") | retried after 20 s, up to 3 times, then 502 |
| One channel failed | 200, noted in `search_errors` |

### Shops, deals and ids

Every endpoint links its deals: each deal has a `shop_id` pointing at an entry in `shops`, and both have ids that stay the same across runs, so a database can upsert them without duplicates. Only `/extract/shops` starts from a Google Maps shop list; the other endpoints start from none, so their shops are the `found_via: "deal"` ones the deals name (`ig:<handle>` when Claude read a handle, else `name:<slug>`).

| Field | Meaning |
| --- | --- |
| `Shop.id` | `gmaps:<Google place id>`; for shops not from Maps, `ig:<handle>`, `tt:<handle>`, else `name:<slug>` |
| `Shop.place_id`, `lat`, `lng`, `maps_url`, `address` | From Google Maps, for linking to the real store and putting it on a map |
| `Shop.website`, `instagram`, `tiktok`, `facebook` | Links from the listing or the shop's site (handles without @) |
| `Shop.hours` | Google Maps opening hours as written there: `[{"day": "Monday", "hours": "11 AM to 10 PM"}, ...]` |
| `Shop.found_via` | `google_maps`, `named` (from `shops`), `mention` (tagged in a creator post), `deal` (only known because a deal named it) |
| `Deal.shop_id` | The shop it's at. Linked by: the shop's own account posted it; else the handle Claude read; else a name match ("Milksha" = "Milksha Westwood"); else a new `found_via: "deal"` shop is added |
| `Deal.id` | `deal:<hash of source URL + quote + code>`. The quote is copied from the source, so re-extracting the same post gives the same id even if Claude words `offer` differently |
| `Deal.flags` | Includes `shop_own_post` or `second_hand` |

A deal with no address gets its shop's.

### Storing results (Convex)

The API stores nothing: results live in the job until the server restarts. Storage is the Convex backend in [`app/convex/`](../app/convex/README.md). Its actions call the extract endpoints with `X-Dibs-Key` and write what they return. The full schema is `app/convex/schema.ts`, with field names as the API returns them (snake_case). The parts the extract endpoints write:

| Table | Upsert key | From |
| --- | --- | --- |
| `agent_runs` | one per job or response | `provider`, `usage`, `brightdata_requests`, `apify_runs`, `search_errors`; the API job id while polling |
| `stores` | `external_id` = `Shop.id`, else Instagram handle, else name within the scanned area | `shops[]`; `Shop.category` → the app's store type (`app/convex/catalog.ts`), `Shop.hours` |
| `sources` | normalized URL (`verify.normalize_url`, ported) | `sources[]` that a deal cites, with `text`, `origin` and `handle` |
| `deals` | `dedupe_key` = store id + offer + code (`verify.py`'s rule, with the store's id instead of its name) | `deals[]`, including the display fields |
| `deal_evidence` | `evidence_key` = `Deal.id` | one row per post behind a deal: quote, post date, `second_hand` |
| `rejected_extractions` | one per rejected deal | `rejected[]` |

A deal is first looked up by `Deal.id` (same post), then by the dedupe key (same offer in another post). `first_seen_at` is kept and `last_verified_at` bumped. A deal is `second_hand` only while every piece of its evidence is. Status is recomputed hourly with `verify.py`'s rules, plus `upcoming` and `hidden` (see `app/convex/lib/status.ts`). The shop-list cache (`ShopCache`) still lives in the API; Convex's own scan cache (`scan_cache`) stops it from re-running the same area within 6 hours.

### Apify setup

1. Sign up at https://console.apify.com (the free plan includes $5 of usage a month). Cal Hacks: Billing → Subscription → promo code `APIFY_CAL_HACKS` adds $200 of credits.
2. Settings → API & Integrations: copy the personal API token into `.env` as `APIFY_TOKEN`.
3. Nothing else: the Actors are public Store Actors, billed per result to your account.

**Memory cap.** Apify limits the memory of all running Actors on an account (16 GB on the free plan, even with promo credits; `GET /v2/users/me/limits`). The Actors' defaults add up past that, so each run asks for less (`ACTOR_MEMORY_MB` in `app/apify.py`: website crawler 4 GB, Maps/TikTok/Facebook 2 GB, Instagram 1 GB) and a process-wide gate makes runs wait for room. Set `APIFY_MEMORY_MB` if your plan allows more.

```bash
JOB=$(curl -s -X POST localhost:8000/extract/shops -H 'content-type: application/json' \
  -d '{"location":{"neighborhood":"Westwood"},"search_terms":["boba"],"max_shops":3}' | python -c 'import json,sys; print(json.load(sys.stdin)["status_url"])')
curl -s localhost:8000$JOB | python -m json.tool   # repeat until "status": "done"
```

Live, 2026-10-24, `{"location":{"neighborhood":"Westwood"},"search_terms":["boba"],"max_shops":3}`:
- Google Maps returned Target, Just Boba Tea House and CHICHA San Chen (Sawtelle). Only CHICHA had a social link (Instagram); none had Facebook or TikTok links, so most of the signal came from Instagram.
- 3 deals came back: CHICHA's K/DA collab drink with a free photocard (`live`, high, `shop_own_post`), its League of Legends prize draw (`needs_check`), and a Molly Tea BOGO from a food influencer's TikTok found by the sweep (second-hand, `needs_check`).
- About 2.5 min and $0.16 in Apify usage with the shop list cached ($0.18 the first time). The TikTok search was the biggest cost ($0.075) and 19 of its 20 results were older than 14 days, so they were dropped. Search results have no date filter, so only recent posts can add mentioned shops.
- Website crawling: `cheerio` (plain HTTP) got no text from CHICHA's JS-built site, so the crawler now runs `playwright:adaptive`. Just Boba's site returns HTTP 502; retries are capped at 2 (the default 10 spent 100 s on it).

Live, 2026-10-24, `{"location":{"neighborhood":"Westwood"},"categories":["food","drink"],"max_shops":10}` (sweep on):
- 10 shops from Maps plus 2 accounts tagged in creator posts; 61 sources (31 Instagram posts, 11 TikToks, 9 Facebook posts, sweep posts). 82 posts older than 14 days were dropped, almost all from the TikTok search, so it now asks for 15 results per query instead of 30.
- 6 deals, every one linked to a shop: Enzo's Pizzeria "30% total off for UCLA students" (`live`, high, own post), CHICHA's K/DA collab drink (`live`, high), Danny Boy's limited sisig pie collab (`live`, medium), a Carl's Jr. (Ackerman Union) $5.99 Mega Deal from a creator post (`live`, medium, `second_hand`, linked to a new `found_via: "deal"` shop), plus two `needs_check`.
- About $1.20 of Apify usage and 8 Actor runs. The website crawler hit its 4 min limit on 12 sites and was retried; timed-out runs are now not retried and sites get 2 pages each instead of 4.

Live, 2026-10-24, `{"categories":["beauty","fitness","retail","entertainment"],"max_shops":8,"sweep":false}` in Westwood: a hair salon, boxing gym, yoga studio, nail salon, thrift shop, clothing store, bookstore and lawn bowling club. 43 sources (18 Instagram, 5 TikTok, 14 Facebook, 6 web pages), website crawl within its limit, but only 1 deal: Nessa Beauty Nails' $90 first-visit gel manicure (own post, linked to its Maps listing). Non-food shops post far fewer time-limited deals. 5 Actor runs, about $0.29, 2.5 min.

Live, 2026-10-24, Bright Data's Google steps on (`{"categories":["food","drink"],"max_shops":6,"sweep":false,"channels":["instagram"]}`, shop list cached): the account lookup found Juice Crafters' Instagram (and its Facebook page on the first run); the deal search found 10 Instagram posts, fetched in full, which added 5 deals at places not on the Maps list: 26 Viet Cafe's BOGO soft opening (its own post), Patty Boys' free smash burger for the first 50 guests, Sana'a Cafe's grand-opening 20% off, each linked to a new `found_via: "deal"` shop. 6 deals in all, 63 s, 11 Bright Data requests (about $0.02) and 1 Apify run. On the first try the post fetch wasn't ready after 90 s and the posts were lost; it now waits up to 240 s (in parallel with the channels) and keeps the snippets if it still fails.

Estimated cost for 8 shops (Store prices on the free plan; higher plans are cheaper): Google Maps + contacts about $0.03, Instagram/TikTok/Facebook at 6 posts per shop about $0.15, websites about $0.10, plus the Claude call. `apify_runs` shows how many Actor runs a job made; the Apify console shows the exact spend.

## Photo confirmation

### `POST /extract/photo` (blocking, 5 to 20 s)

A user's photo of a poster, window sign, flyer or menu board. Multipart form: `image` (JPEG, PNG, WebP or GIF, up to 5 MB; the type is checked from the file bytes), optional `shop` (name hint), `photo_date` (default today) and `timezone` (default `America/Los_Angeles`).

```bash
curl -s -F image=@poster.jpg -F shop="Chipotle Westwood" localhost:8000/extract/photo | python -m json.tool
```

Claude transcribes every word in the image (returned as `transcript`), then records the deals with a time window (`start_time` / `end_time`, e.g. "3PM to close" is `15:00` / `null` plus the condition "until close"). The usual rules apply, with the transcript as the source text:

| Rule | Result |
| --- | --- |
| Quote isn't in the transcript | rejected: `quote_not_in_source` |
| Date shown without a year ("July 6th") | year set to the occurrence nearest `photo_date`, flag `year_inferred` |
| Post date | always `photo_date` |

**Demo:** open http://localhost:8000/demo for a phone-sized version of the flow (the Figma "Earn $5" and "Submission result" screens). Take a photo with your webcam or upload one, and it calls `/extract/photo` and shows whether the deal is confirmed, when it runs, its fine print, and the quote found on the poster. Photos are shrunk to 1568 px on the long edge before upload. Camera access needs `localhost` or HTTPS.

Status is judged against today, so a poster for a date that has passed comes back `expired`. Returns the usual response with `provider: "user_photo"` and one source, `https://dibs.local/photo/<hash>` (a stable id for the image, not a real page). Errors: 413 over 5 MB, 415 not an image, 422 missing image or unknown timezone. Nothing is stored.

## Bright Data setup

1. Sign up with the Cal Hacks promo ($300 credits): https://brightdata.com/?promo=calhack2026&hs_signup=1
2. Create an API key in account settings and put it in `.env` as `BRIGHTDATA_API_KEY` (`BRIGHTDATA_API_TOKEN` also works).
3. Create a SERP API zone in the dashboard and put its name in `.env` as `BRIGHTDATA_SERP_ZONE`. A Web Unlocker zone works too. Left blank, the app uses the account's first `serp` or `unblocker` zone.
4. The Instagram scraper needs no zone, only the API key. The Web Scraper API needs an active account: if a job fails with `Customer is not active`, finish account activation (billing details / verification) in the Bright Data dashboard.
5. Smoke tests (keep uvicorn on 127.0.0.1, its default: these endpoints spend your Bright Data credits and are open while `DIBS_API_KEY` is blank):

```bash
set -a; source .env; set +a
curl -s -H "Authorization: Bearer $BRIGHTDATA_API_KEY" -H "Content-Type: application/json" \
  -d '{"zone":"'$BRIGHTDATA_SERP_ZONE'","url":"https://www.google.com/search?q=westwood+boba+deal&hl=en&gl=us&brd_json=1","format":"raw","country":"us"}' \
  https://api.brightdata.com/request | head -c 400

curl -s -X POST localhost:8000/extract/serp -H 'content-type: application/json' \
  -d '{"location":{"neighborhood":"Westwood"},"categories":["drink"],"max_queries":2}' | python -m json.tool

JOB=$(curl -s -X POST localhost:8000/extract/instagram -H 'content-type: application/json' \
  -d '{"handles":["26vietcafe.usa"],"num_of_posts":5}' | python -c 'import json,sys; print(json.load(sys.stdin)["status_url"])')
curl -s localhost:8000$JOB | python -m json.tool   # repeat until "status": "done"
```

## Tests

```bash
uv run pytest -q
```

225 tests: every verification rule, the display fields and the API key, the multi-turn tool loop (pause_turn, forced tool, give-up), malformed output, search errors, the Bright Data client (retries, polling, timeouts, error rows), both Bright Data pipelines, the Apify client (request shape, errors, memory cap, each Actor's output), the shop pipeline (attribution, sweep, cache, batching, per-channel failures), the Bright Data Google steps (handle matching, account lookup, deal search) and deal-to-shop linking, photo extraction (year inference, time windows, upload checks), the job flow, and the API. They use a fake Claude client returning real SDK `Message` objects and `httpx.MockTransport` for Bright Data and Apify, so no keys or credits are needed.

## Cost and settings

- Web search: $10 per 1,000 searches, plus tokens. `max_searches` defaults to 5 (max 10).
- Model: `DIBS_MODEL` env var, default `claude-opus-5-5`. Any model that supports the web search tool works; a smaller model is cheaper for frequent runs.
- Web search tool version: `web_search_20250305`, the basic version that works with direct calls.
- Bright Data: billed per request on your account; `brightdata_requests` in each response shows how many were made. Check usage in the Bright Data dashboard.
- Apify: billed per result by each Actor; `apify_runs` shows how many runs a job made. See the Apify section for estimates.

## Not in this MVP

Instagram stories, speech-to-text for TikTok/reels, and user auth (the API only checks the shared `DIBS_API_KEY`). Storage, scheduling, users, photo submissions and credits live in the Convex backend (`../app/convex/`). The mobile app is in `../app/`. CORS is wide open for the hackathon; tighten it before launch.

## Layout

```
app/schemas.py    Pydantic models: RawDeal (from Claude), Deal (verified), request/response
app/extractor.py  Claude web search call, tool definitions, prompt, turn loop
app/brightdata.py Bright Data client: SERP API, Instagram posts scraper
app/apify.py      Apify client: Google Maps, Instagram, TikTok, Facebook, website Actors
app/sources.py    SourceDoc: one shape for everything Bright Data or Apify fetched
app/bd_pipeline.py Bright Data fetch -> Claude extraction -> verification
app/shop_pipeline.py Google Maps shops -> each shop's channels (Apify) -> extraction -> verification
app/linking.py    Deal -> shop links, stable shop and deal ids
app/google_lookup.py Bright Data Google search for /extract/shops: missing accounts, deal posts
app/photo.py      User photo -> Claude transcript + deals -> verification
app/jobs.py       In-memory background jobs (Instagram, shops)
app/errors.py     Upstream error -> HTTP status mapping
app/verify.py     Deterministic verification rules
app/main.py       FastAPI app
tests/            pytest suite
```
