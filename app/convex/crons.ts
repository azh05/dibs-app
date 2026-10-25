import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// 24/7 agents: scan areas people have saved that have no shop list yet (each at most every 6 hours; a few per tick).
crons.interval("scan saved areas", { hours: 1 }, internal.scans.scheduleAreas, {});
// Areas with a shop list: the next batch of due stores in each (batches.ts; tiers set how often a store is due).
crons.interval("scan area stores", { hours: 1 }, internal.batches.scheduleBatches, {});
// Once a day per area: the keyword sweep and Google deal search, for creator posts and roundups (10 AM in LA).
crons.cron("sweep areas", "0 17 * * *", internal.batches.scheduleSweeps, {});
// Each watched area's shop list from Google Maps, refreshed weekly (areas.DISCOVERY_TTL); a few areas per tick.
crons.interval("discover area shops", { hours: 6 }, internal.areas.scheduleDiscovery, {});
// Dates pass: expire, go stale, start upcoming deals.
crons.interval("recompute deal status", { hours: 1 }, internal.deals.recomputeStatus, {});
// Safety net for credit settle jobs.
crons.daily("settle due credits", { hourUTC: 10, minuteUTC: 17 }, internal.credits.settleDue, {});
crons.interval("rebuild leaderboards", { hours: 1 }, internal.leaderboards.rebuild, {});
crons.weekly("weekly challenge", { dayOfWeek: "monday", hourUTC: 8, minuteUTC: 7 }, internal.challenges.rollover, {});

export default crons;
