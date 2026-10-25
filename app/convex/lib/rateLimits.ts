import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";

import { components } from "../_generated/api";

const DAY = 24 * HOUR;

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // /extract/search spends web searches (and 10 to 60 s of Claude), so users get a few an hour.
  userSearch: { kind: "token bucket", rate: 3, period: HOUR, capacity: 3 },
  photoSubmit: { kind: "token bucket", rate: 10, period: DAY, capacity: 5 },
  lineReport: { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
  vote: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 20 },
  friendRequest: { kind: "token bucket", rate: 30, period: DAY, capacity: 10 },
});
