import { expect, test } from "vitest";

import { byScanPriority, nextScanAt, scannable, tierFor } from "./tiers";
import { DAY } from "./time";

const NOW = Date.UTC(2026, 9, 24, 18);
const old = NOW - 60 * DAY; // created long ago
const ig = { instagram_handle: "tapiocalab" };

test("scannable: a social account or a website that isn't one", () => {
  expect(scannable(ig)).toBe(true);
  expect(scannable({ website: "https://milksha.com/" })).toBe(true);
  expect(scannable({ website: "https://www.instagram.com/milksha_ca/" })).toBe(false);
  expect(scannable({ website: "m.facebook.com/milksha" })).toBe(false);
  expect(scannable({})).toBe(false);
});

test("hot: a recent deal, a follower, or a new food or drink store", () => {
  expect(tierFor({ ...ig, created_at: old, last_deal_at: NOW - 10 * DAY }, { followed: false, now: NOW })).toBe("hot");
  expect(tierFor({ ...ig, created_at: old, quiet_scans: 5 }, { followed: true, now: NOW })).toBe("hot");
  expect(tierFor({ ...ig, created_at: NOW - DAY, store_type: "boba_tea" }, { followed: false, now: NOW })).toBe("hot");
});

test("a new store outside food and drink starts cold", () => {
  expect(tierFor({ ...ig, created_at: NOW - DAY, store_type: "gyms" }, { followed: false, now: NOW })).toBe("cold");
  expect(tierFor({ ...ig, created_at: NOW - DAY }, { followed: false, now: NOW })).toBe("cold");
});

test("warm: posts weekly, or not known to have gone quiet", () => {
  expect(tierFor({ ...ig, created_at: old, last_post_at: NOW - 3 * DAY }, { followed: false, now: NOW })).toBe("warm");
  expect(tierFor({ ...ig, created_at: old, last_post_at: NOW - 20 * DAY }, { followed: false, now: NOW })).toBe("warm");
  expect(tierFor({ ...ig, created_at: old, quiet_scans: 1 }, { followed: false, now: NOW })).toBe("warm");
});

test("cold: two quiet scans, no post in 30 days, an old deal, or nothing to scrape", () => {
  expect(tierFor({ ...ig, created_at: old, quiet_scans: 2 }, { followed: false, now: NOW })).toBe("cold");
  expect(tierFor({ ...ig, created_at: old, last_post_at: NOW - 31 * DAY }, { followed: false, now: NOW })).toBe("cold");
  expect(
    tierFor({ ...ig, created_at: old, last_deal_at: NOW - 40 * DAY, quiet_scans: 2 }, { followed: false, now: NOW }),
  ).toBe("cold");
  expect(tierFor({ created_at: NOW, store_type: "cafes" }, { followed: true, now: NOW })).toBe("cold");
});

test("intervals and batch order", () => {
  expect(nextScanAt("hot", NOW)).toBe(NOW + DAY);
  expect(nextScanAt("warm", NOW)).toBe(NOW + 3 * DAY);
  expect(nextScanAt("cold", NOW)).toBe(NOW + 7 * DAY);
  const stores = [
    { name: "cold, overdue", next_scan_at: 5, scan_tier: "cold" as const },
    { name: "warm, same time", next_scan_at: 10, scan_tier: "warm" as const },
    { name: "hot, same time", next_scan_at: 10, scan_tier: "hot" as const },
    { name: "never scheduled" },
  ];
  expect(stores.sort(byScanPriority).map((s) => s.name)).toEqual([
    "never scheduled",
    "cold, overdue",
    "hot, same time",
    "warm, same time",
  ]);
});
