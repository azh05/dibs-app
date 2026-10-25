#!/usr/bin/env bash
# Batch scans: fill scan areas with deals. Run from app/ on a machine logged in to the Convex deployment
# (npx convex dev has been run once). Results land in Convex (the app feed) and Elastic (search, Ask dibs).
#
#   scripts/batch-scan.sh '<area JSON>' ['<area JSON>' ...]     4 scans per area by search term, ~95 shops
#   scripts/batch-scan.sh --all <area id> [<area id> ...]        every shop in each area's discovered list
#   scripts/batch-scan.sh --place "Mission District, San Francisco, California" [--place ...]
#                                                                 a place not in Convex yet, same 4 scans
#
# Area JSON and ids come from `npx convex data scan_areas`. Area JSON looks like:
#   {"scan_area_key":"...","neighborhood":"Westwood","city":"Los Angeles","region":"California",
#    "timezone":"America/Los_Angeles","lat":34.0628,"lng":-118.4455,"radius_miles":1}
# --all uses the shops discovery stored for the area (up to 250), 25 per scan: about $0.05 per shop and
# 10 scans (an hour) for 250 shops. Discovery must have finished for the area first.
#
# --place needs no scan area: shops are found on Google Maps by neighborhood and city, and their deals land in
# Convex with the shops' coordinates. To see them in the app, set your location (or a saved place) there. Format
# "Neighborhood, City, State[, Timezone]"; the timezone defaults to America/Los_Angeles.
#
# Each scan covers up to 25 shops and takes 1-5 min. Scans start GAP seconds apart (default 360) so they don't
# queue on Apify's 16 GB memory cap past Convex's 10-minute polling limit. Uses Apify, plus Bright Data's Google
# lookups when BRIGHTDATA_API_KEY is set on the API.
set -euo pipefail
[ $# -ge 1 ] || { sed -n 2,22p "$0"; exit 1; }
GAP="${GAP:-360}"
BATCH_SIZE=25

# JSON helper: node reads stdin and runs the given expression on it as `d`.
js() { node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const d=JSON.parse(s);$1})"; }

SCAN_AREAS=() SCAN_REQS=() # one area JSON and one request JSON per scan
if [ "$1" = "--all" ]; then
  shift
  [ $# -ge 1 ] || { echo "--all needs at least one area id"; exit 1; }
  for AREA_ID in "$@"; do
    AREA=$(npx convex run areas:get "{\"areaId\":\"$AREA_ID\"}" | js '
      if (!d) throw new Error("no scan area with that id");
      const a = {scan_area_key: d.key, neighborhood: d.neighborhood, city: d.city, region: d.region,
                 timezone: d.timezone, lat: d.lat, lng: d.lng, radius_miles: d.radius_miles};
      for (const k of Object.keys(a)) if (a[k] === undefined || a[k] === null) delete a[k];
      console.log(JSON.stringify(a));')
    NAMES='[]' CURSOR=null
    while :; do
      PAGE=$(npx convex run areas:storesInArea "{\"areaId\":\"$AREA_ID\",\"paginationOpts\":{\"numItems\":100,\"cursor\":$CURSOR}}")
      NAMES=$(printf '%s' "$PAGE" | NAMES="$NAMES" js '
        const names = JSON.parse(process.env.NAMES).concat(d.page.map(r => r.store && r.store.name).filter(Boolean));
        console.log(JSON.stringify([...new Set(names)]));')
      [ "$(printf '%s' "$PAGE" | js 'console.log(d.isDone)')" = true ] && break
      CURSOR=$(printf '%s' "$PAGE" | js 'console.log(JSON.stringify(d.continueCursor))')
    done
    COUNT=$(printf '%s' "$NAMES" | js 'console.log(d.length)')
    echo "$(printf '%s' "$AREA" | js 'console.log(d.neighborhood || d.city)'): $COUNT shops"
    [ "$COUNT" -gt 0 ] || { echo "  no discovered shops yet; run discovery for this area first"; continue; }
    # The creator sweep (TikTok, hashtags) runs once per area, on the first batch.
    while IFS= read -r REQ; do SCAN_AREAS+=("$AREA"); SCAN_REQS+=("$REQ"); done < <(printf '%s' "$NAMES" | BATCH=$BATCH_SIZE js '
      const n = Number(process.env.BATCH);
      for (let i = 0; i < d.length; i += n)
        console.log(JSON.stringify({shops: d.slice(i, i + n), max_shops: n, sweep: i === 0}));')
  done
else
  if [ "$1" = "--place" ]; then
    # Turn each --place "Neighborhood, City, State[, Timezone]" into area JSON, then scan it like any area.
    PLACES=()
    while [ $# -ge 2 ] && [ "$1" = "--place" ]; do PLACES+=("$2"); shift 2; done
    [ $# -eq 0 ] && [ ${#PLACES[@]} -gt 0 ] || { echo 'usage: --place "Neighborhood, City, State" [--place ...]'; exit 1; }
    for P in "${PLACES[@]}"; do
      set -- "$@" "$(printf '%s' "\"$P\"" | js '
        const [neighborhood, city, region, timezone] = d.split(",").map(x => x.trim());
        if (!neighborhood || !city || !region) throw new Error("--place needs \"Neighborhood, City, State\"");
        const key = [neighborhood, city, region].join("|").toLowerCase();
        console.log(JSON.stringify({scan_area_key: key, neighborhood, city, region,
                                    timezone: timezone || "America/Los_Angeles", radius_miles: 1}));')"
    done
  fi
  BATCHES=(
    '{"search_terms":["boba","coffee shop","juice bar","dessert"],"max_shops":25}'
    '{"search_terms":["pizza","burger","tacos","fast food"],"max_shops":25}'
    '{"search_terms":["ramen","sushi","korean","thai","restaurant"],"max_shops":25}'
    '{"categories":["beauty","fitness","retail","entertainment"],"max_shops":20,"sweep":false}'
  )
  for AREA in "$@"; do
    for BATCH in "${BATCHES[@]}"; do SCAN_AREAS+=("$AREA"); SCAN_REQS+=("$BATCH"); done
  done
fi

total=${#SCAN_REQS[@]}
[ "$total" -gt 0 ] || { echo "Nothing to scan."; exit 1; }
echo "$total scans, about $(( (total - 1) * GAP / 60 )) min to start them all."
for i in "${!SCAN_REQS[@]}"; do
  AREA="${SCAN_AREAS[$i]}" REQ="${SCAN_REQS[$i]}"
  echo "[$(date +%H:%M)] scan $((i + 1))/$total"
  npx convex run scans:startShops "{\"area\":$AREA,\"trigger\":\"schedule\",\"force\":true,\"request\":$REQ}"
  [ "$i" -lt $((total - 1)) ] && sleep "$GAP"
done
echo "All $total scans started. Progress: npx convex data agent_runs --limit 10 --order desc"
