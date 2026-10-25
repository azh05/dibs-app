#!/usr/bin/env bash
# Batch scans: fill one or more scan areas with deals, 4 Apify scans per area with different search terms.
# Run from app/ on a machine logged in to the Convex deployment (npx convex dev has been run once).
#
#   scripts/batch-scan.sh '<area JSON>' ['<area JSON>' ...]
#
# Area JSON comes from `npx convex data scan_areas`:
#   {"scan_area_key":"...","neighborhood":"Westwood","city":"Los Angeles","region":"California",
#    "timezone":"America/Los_Angeles","lat":34.0628,"lng":-118.4455,"radius_miles":1}
#
# Each scan covers up to 25 shops, takes 1-5 min and about $1-1.50 of Apify. Scans start GAP seconds apart
# (default 360) so they don't queue on Apify's 16 GB memory cap past Convex's 10-minute polling limit.
# Results land in Convex (the app feed) and Elastic (search, Ask dibs).
set -euo pipefail
[ $# -ge 1 ] || { sed -n 2,13p "$0"; exit 1; }
GAP="${GAP:-360}"
BATCHES=(
  '{"search_terms":["boba","coffee shop","juice bar","dessert"],"max_shops":25}'
  '{"search_terms":["pizza","burger","tacos","fast food"],"max_shops":25}'
  '{"search_terms":["ramen","sushi","korean","thai","restaurant"],"max_shops":25}'
  '{"categories":["beauty","fitness","retail","entertainment"],"max_shops":20,"sweep":false}'
)
total=$(( $# * ${#BATCHES[@]} )); n=0
for AREA in "$@"; do
  for BATCH in "${BATCHES[@]}"; do
    n=$((n + 1))
    echo "[$(date +%H:%M)] scan $n/$total: $BATCH"
    npx convex run scans:startShops "{\"area\":$AREA,\"trigger\":\"schedule\",\"force\":true,\"request\":$BATCH}"
    [ "$n" -lt "$total" ] && sleep "$GAP"
  done
done
echo "All $total scans started. Progress: npx convex data agent_runs --limit 8 --order desc"
