// Parity with the Python helpers in api/app (verify.py, linking.py) and the status rules.
import { expect, test } from "vitest";

import { storeTypeFor } from "../catalog";
import { computeStatus } from "./status";
import { namesMatch, normalizeUrl, similarity } from "./text";
import { localToEpoch, monthStart, weekStart } from "./time";

test("normalizeUrl ignores scheme, www, query and trailing slash", () => {
  expect(normalizeUrl("https://www.Instagram.com/p/abc/?igsh=xyz")).toBe(normalizeUrl("http://instagram.com/p/abc"));
  expect(normalizeUrl("https://dibs.local/photo/abc123")).toBe("dibs.local/photo/abc123");
});

test("similarity matches difflib.SequenceMatcher.ratio", () => {
  const cases: [string, string, number][] = [
    ["boba guys", "boba time", 0.5556],
    ["tea", "tea station westwood", 0.2609],
    ["chicha san chen sawtelle", "chicha san chen", 0.7692],
    ["milksha westwood", "milksha westwod", 0.9677],
    ["tapioca lab", "tapioca labs", 0.9565],
  ];
  for (const [a, b, ratio] of cases) expect(similarity(a, b)).toBeCloseTo(ratio, 3);
});

test("namesMatch follows linking.names_match", () => {
  expect(namesMatch("Milksha", "Milksha Westwood")).toBe(true);
  expect(namesMatch("CHICHA San Chen - Sawtelle", "Chicha San Chen")).toBe(true);
  expect(namesMatch("Tea", "Tea Station Westwood")).toBe(false);
  expect(namesMatch("Boba Guys", "Boba Time")).toBe(false);
});

const TODAY = "2026-10-24";
const base = { confidence: "high" as const, ended_count: 0 };

test("status follows verify.py step 5 and 6", () => {
  expect(computeStatus({ ...base, end_date: "2026-10-31" }, TODAY)).toBe("live");
  expect(computeStatus({ ...base, end_date: "2026-10-23" }, TODAY)).toBe("expired");
  expect(computeStatus({ ...base, source_post_date: "2026-09-01" }, TODAY)).toBe("stale");
  expect(computeStatus({ ...base, source_post_date: "2026-10-20" }, TODAY)).toBe("live");
  expect(computeStatus({ ...base }, TODAY)).toBe("needs_check");
  expect(computeStatus({ ...base, confidence: "low", end_date: "2026-10-31" }, TODAY)).toBe("needs_check");
});

test("status adds upcoming and hidden", () => {
  expect(computeStatus({ ...base, start_date: "2026-11-01", end_date: "2026-11-02" }, TODAY)).toBe("upcoming");
  expect(computeStatus({ ...base, start_date: "2026-11-01", end_date: "2026-10-01" }, TODAY)).toBe("expired");
  expect(computeStatus({ ...base, ended_count: 3, end_date: "2026-10-31" }, TODAY)).toBe("hidden");
});

test("local times convert across DST", () => {
  expect(new Date(localToEpoch("2026-07-06", "15:00", "America/Los_Angeles")).toISOString()).toBe("2026-07-06T22:00:00.000Z");
  expect(new Date(localToEpoch("2026-12-06", "15:00", "America/Los_Angeles")).toISOString()).toBe("2026-12-06T23:00:00.000Z");
  expect(weekStart(Date.parse("2026-10-24T20:00:00Z"))).toBe("2026-10-19");
  expect(monthStart(Date.parse("2026-10-24T20:00:00Z"))).toBe("2026-10-01");
});

test("Google categories map onto the catalog", () => {
  expect(storeTypeFor("Bubble tea store")).toBe("boba_tea");
  expect(storeTypeFor("Coffee shop")).toBe("cafes");
  expect(storeTypeFor("Hamburger restaurant")).toBe("fast_food");
  expect(storeTypeFor("Sushi restaurant")).toBe("restaurants");
  expect(storeTypeFor("Barber shop")).toBe("hair_barbers");
  expect(storeTypeFor("Nail salon")).toBe("nails");
  expect(storeTypeFor("Boxing gym")).toBe("boxing_martial_arts");
  expect(storeTypeFor("Thrift store")).toBe("clothing_thrift");
  expect(storeTypeFor(null, "fitness")).toBe("gyms");
  expect(storeTypeFor("Unknown thing")).toBeUndefined();
});
