// Same math as app/src/lib/social.ts levelFor, so users.level matches what the Profile shows.
export const XP_PER_LEVEL = 1000;

export const LEVEL_NAMES = [
  "Newcomer",
  "Bargain Spotter",
  "Coupon Clipper",
  "Local Regular",
  "Savvy Saver",
  "Sale Scout",
  "Deal Hunter",
  "Deal Legend",
  "Dibs Royalty",
];

export function levelFor(xp: number): number {
  return Math.min(Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1, LEVEL_NAMES.length);
}
