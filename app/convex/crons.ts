import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// 24/7 agents: scan areas people have saved (each area at most every 6 hours; a few areas per tick).
crons.interval("scan saved areas", { hours: 1 }, internal.scans.scheduleAreas, {});
// Dates pass: expire, go stale, start upcoming deals.
crons.interval("recompute deal status", { hours: 1 }, internal.deals.recomputeStatus, {});
// Safety net for credit settle jobs.
crons.daily("settle due credits", { hourUTC: 10, minuteUTC: 17 }, internal.credits.settleDue, {});
crons.interval("rebuild leaderboards", { hours: 1 }, internal.leaderboards.rebuild, {});
crons.weekly("weekly challenge", { dayOfWeek: "monday", hourUTC: 8, minuteUTC: 7 }, internal.challenges.rollover, {});

export default crons;
