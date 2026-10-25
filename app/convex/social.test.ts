import { expect, test } from "vitest";

import { api } from "./_generated/api";
import { identity, makeTest, type T } from "./test.setup";

async function signIn(t: T, n: number, profile: { username?: string; display_name?: string } = {}) {
  const as = t.withIdentity(identity(n));
  const userId = await as.mutation(api.users.store, {});
  if (profile.username || profile.display_name) await as.mutation(api.users.updateProfile, profile);
  return { as, userId };
}

const usernames = (people: { username: string | null }[]) => people.map((p) => p.username);

test("find friends by @username prefix or by name, without yourself", async () => {
  const t = makeTest();
  const me = await signIn(t, 1, { username: "anthony", display_name: "Anthony Zhao" });
  await signIn(t, 2, { username: "mayasaves", display_name: "Maya Rodriguez" });
  await signIn(t, 3, { username: "jess.eats", display_name: "Jessica Mayfield" });

  expect(usernames(await me.as.query(api.social.findPeople, { query: "may" }))).toEqual(["mayasaves", "jess.eats"]);
  expect(usernames(await me.as.query(api.social.findPeople, { query: "@may" }))).toEqual(["mayasaves"]); // @ = usernames only
  expect(usernames(await me.as.query(api.social.findPeople, { query: "rodriguez" }))).toEqual(["mayasaves"]);
  expect(usernames(await me.as.query(api.social.findPeople, { query: "anth" }))).toEqual([]);
  expect(await me.as.query(api.social.findPeople, { query: "m" })).toEqual([]);
});

test("a friend request needs a username first", async () => {
  const t = makeTest();
  const noName = await signIn(t, 1);
  const maya = await signIn(t, 2, { username: "mayasaves" });
  await expect(noName.as.mutation(api.social.request, { userId: maya.userId })).rejects.toThrow(/Pick a username/);
  await noName.as.mutation(api.users.updateProfile, { username: "newbie" });
  expect(await noName.as.mutation(api.social.request, { userId: maya.userId })).toBe("pending");
});

test("a Clerk nickname someone already has isn't taken over on sign-up", async () => {
  const t = makeTest();
  await signIn(t, 1, { username: "maya" });
  const twin = t.withIdentity({ ...identity(2), nickname: "maya" });
  await twin.mutation(api.users.store, {});
  expect((await twin.query(api.users.me, {}))!.username).toBeNull();
  const fresh = t.withIdentity({ ...identity(3), nickname: "Jess" });
  await fresh.mutation(api.users.store, {});
  expect((await fresh.query(api.users.me, {}))!.username).toBe("jess");
});
