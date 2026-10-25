import { afterEach, beforeEach, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import { identity, json, makeTest, shopsResponse, stubFetch, type T } from "./test.setup";

let restore: () => void = () => {};
beforeEach(() => {
  process.env.DIBS_API_URL = "http://api.test";
});
afterEach(() => restore());

async function seed(t: T) {
  restore = stubFetch(() => json({ job_id: "j", status: "done", progress: [], result: shopsResponse() })).restore;
  const runId = await t.mutation(internal.ingest.startRun, {
    provider: "apify_shops",
    trigger: "schedule",
    area: { scan_area_key: "westwood|los angeles|california", neighborhood: "Westwood" },
    queries: [],
  });
  await t.mutation(internal.ingest.updateRun, { runId, status: "running", api_job_id: "j" });
  await t.action(internal.scans.pollShops, { runId });
  restore();
  return t.run(async (ctx) => {
    const deals = await ctx.db.query("deals").collect();
    return { boba: deals.find((d) => d.offer.startsWith("BOGO"))!._id, wings: deals.find((d) => d.offer.startsWith("Half"))!._id };
  });
}

async function signIn(t: T, n: number, username: string, neighborhood = "Westwood") {
  const as = t.withIdentity(identity(n));
  const userId = await as.mutation(api.users.store, {});
  await as.mutation(api.users.updateProfile, { username, home_neighborhood: neighborhood });
  return { as, userId };
}

test("saving and using a deal: XP, $ saved, a badge, the friends feed and challenge progress", async () => {
  const t = makeTest();
  const { boba } = await seed(t);
  await t.mutation(internal.challenges.rollover, {});
  const { as } = await signIn(t, 1, "maya");

  expect(await as.mutation(api.saves.toggleSave, { dealId: boba })).toBe(true);
  expect((await as.query(api.reminders.mine, {})).map((r) => r.reason)).toEqual(["ending_soon"]); // "We'll remind you"
  expect((await as.query(api.saves.saved, {}))[0]).toMatchObject({ id: boba, saved: true, used: false });

  await as.mutation(api.saves.markUsed, { dealId: boba });
  await as.mutation(api.saves.markUsed, { dealId: boba }); // once only
  const me = (await as.query(api.users.me, {}))!;
  expect(me).toMatchObject({ xp: 50, streak_weeks: 1, featured_badge_id: "first_dibs" });
  const stats = (await as.query(api.profile.stats, {}))!;
  expect(stats).toMatchObject({ saved_cents: 650, deals_used: 1, badges_earned: 1, badge_total: 24 });
  expect(stats.deal_dna.slices).toEqual([{ label: "Boba & tea", percent: 100 }]);
  expect(await as.mutation(api.saves.toggleSave, { dealId: boba })).toBe(true); // used deals stay saved
});

test("challenges complete and pay XP", async () => {
  const t = makeTest();
  const { boba, wings } = await seed(t);
  await t.run(async (ctx) => {
    const { weekStart } = await import("./lib/time");
    await ctx.db.insert("challenges", { week_start: weekStart(Date.now()), title: "Use 2 deals", metric: "deals_used", target: 2, xp_reward: 100 });
  });
  const { as } = await signIn(t, 1, "maya");
  await as.mutation(api.saves.markUsed, { dealId: boba });
  expect((await as.query(api.challenges.current, {}))[0]).toMatchObject({ done: 1, goal: 2, completed: false });
  await as.mutation(api.saves.markUsed, { dealId: wings });
  expect((await as.query(api.challenges.current, {}))[0]).toMatchObject({ done: 2, completed: true });
  expect((await as.query(api.users.me, {}))!.xp).toBe(50 + 50 + 100);
});

test("friends: request, accept, feed and cheers", async () => {
  const t = makeTest();
  const { boba } = await seed(t);
  const maya = await signIn(t, 1, "maya");
  const jess = await signIn(t, 2, "jess");
  expect((await maya.as.query(api.social.findPeople, { query: "je" })).map((u) => u.username)).toEqual(["jess"]);
  expect(await maya.as.mutation(api.social.request, { userId: jess.userId })).toBe("pending");
  expect((await jess.as.query(api.social.friends, {})).incoming.map((u) => u.username)).toEqual(["maya"]);
  await jess.as.mutation(api.social.respond, { userId: maya.userId, accept: true });
  expect((await maya.as.query(api.social.friends, {})).friends.map((u) => u.username)).toEqual(["jess"]);

  await jess.as.mutation(api.saves.markUsed, { dealId: boba });
  const feed = await maya.as.query(api.social.feed, {});
  const used = feed.find((f) => f.type === "used_deal")!;
  expect(used).toMatchObject({ verb: "used", subject: "BOGO milk tea", place: "Tapioca Lab", cheered: false, likes: 0 });
  expect(used.card).toMatchObject({ id: boba, kind: "deal", title: "BOGO milk tea", subtitle: "Tapioca Lab" });
  expect(feed.some((f) => f.verb === "unlocked" && f.subject === "First Dibs")).toBe(true);
  expect(await maya.as.mutation(api.social.react, { activityId: used.id, kind: "cheer" })).toBe(true);
  expect((await maya.as.query(api.social.feed, {})).find((f) => f.id === used.id)).toMatchObject({ cheered: true, likes: 1 });
});

test("leaderboards rank $ saved this month by neighbourhood and among friends", async () => {
  const t = makeTest();
  const { boba, wings } = await seed(t);
  const maya = await signIn(t, 1, "maya");
  const jess = await signIn(t, 2, "jess");
  const sam = await signIn(t, 3, "sam", "Sawtelle");
  await maya.as.mutation(api.saves.markUsed, { dealId: boba }); // $6.50
  await jess.as.mutation(api.saves.markUsed, { dealId: wings, saved_cents: 1200 });
  await sam.as.mutation(api.saves.markUsed, { dealId: wings, saved_cents: 5000 });
  await t.mutation(internal.leaderboards.rebuild, {});

  const westwood = (await maya.as.query(api.leaderboards.board, { scope: "neighborhood" }))!;
  expect(westwood.label).toBe("Westwood");
  expect(westwood.ranked.map((r) => [r.username, r.saved_cents, r.rank])).toEqual([
    ["jess", 1200, 1],
    ["maya", 650, 2],
  ]);
  expect(westwood.you).toMatchObject({ rank: 2, percentile: 100 });

  await maya.as.mutation(api.social.request, { userId: sam.userId });
  await sam.as.mutation(api.social.respond, { userId: maya.userId, accept: true });
  const friends = (await maya.as.query(api.leaderboards.board, { scope: "friends" }))!;
  expect(friends.ranked.map((r) => r.username)).toEqual(["sam", "maya"]);
  expect(friends.you).toMatchObject({ rank: 2, to_next_cents: 5000 - 650 });
  expect(westwood.you!.to_next_cents).toBe(1200 - 650);
  const stats = (await maya.as.query(api.profile.stats, {}))!;
  expect(stats.friends).toBe(1);
  expect(stats.friend_faces.map((f) => f.username)).toEqual(["sam"]);
  expect(stats.weekly_saved_cents).toHaveLength(7);
  expect(stats.weekly_saved_cents[6]).toBe(650); // this week's bar

  // Friends tab: you and your friends with your ranks on the area board (Sam is on Sawtelle's board).
  await maya.as.mutation(api.social.request, { userId: jess.userId });
  await jess.as.mutation(api.social.respond, { userId: maya.userId, accept: true });
  const ranks = await maya.as.query(api.leaderboards.friendRanks, { scope: "neighborhood" });
  expect(ranks.map((r) => [r.username, r.rank, r.you])).toEqual([
    ["jess", 1, false],
    ["maya", 2, true],
  ]);
});

test("lists hold deals and stores", async () => {
  const t = makeTest();
  const { boba } = await seed(t);
  const { as } = await signIn(t, 1, "maya");
  const listId = await as.mutation(api.saves.createList, { name: "Want to try", icon: "bookmark" });
  await as.mutation(api.saves.addToList, { listId, dealId: boba });
  await as.mutation(api.saves.addToList, { listId, dealId: boba }); // no duplicates
  expect(await as.query(api.saves.lists, {})).toEqual([{ id: listId, name: "Want to try", icon: "bookmark", spots: 1 }]);
  const other = t.withIdentity(identity(2));
  await other.mutation(api.users.store, {});
  await expect(other.mutation(api.saves.addToList, { listId, dealId: boba })).rejects.toThrow("Not your list");
});
