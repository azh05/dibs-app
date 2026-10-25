// Profile, leaderboard and friends data (Figma "5 · Profile & social"). There is no social
// backend yet, so everything here is mock data shaped like the screens.
import { Share } from 'react-native';

import type { IconName } from '@/components/icon';
import { colors } from '@/theme';

/** XP the demo user has before this session: level 7, 720 of 1,000 toward level 8. */
export const STARTING_XP = 6720;

const XP_PER_LEVEL = 1000;
const LEVEL_NAMES = [
  'Newcomer',
  'Bargain Spotter',
  'Coupon Clipper',
  'Local Regular',
  'Savvy Saver',
  'Sale Scout',
  'Deal Hunter',
  'Deal Legend',
  'Dibs Royalty',
];

export function levelFor(xp: number) {
  const level = Math.min(Math.floor(xp / XP_PER_LEVEL) + 1, LEVEL_NAMES.length);
  return {
    level,
    name: LEVEL_NAMES[level - 1],
    next: LEVEL_NAMES[level] ?? null,
    progress: xp % XP_PER_LEVEL,
    goal: XP_PER_LEVEL,
  };
}

export const PROFILE_STATS = {
  savedDollars: 312,
  joinedMonth: 'Sep',
  /** Dollars saved in each of the last 7 weeks, oldest first; the last bar is this week. */
  weeklySaved: [16, 26, 19, 35, 29, 42, 48],
  dealsUsed: 48,
  friends: 128,
};

/** This month's mix of deals used, largest first; "Other" sits last in grey. */
export const DEAL_DNA = {
  slices: [
    { label: 'Boba & tea', percent: 32, color: colors.orange },
    { label: 'Nails', percent: 18, color: colors.orangeDeep },
    { label: 'Cafes', percent: 15, color: colors.pinDay },
    { label: 'Gyms', percent: 12, color: colors.pinWeek },
    { label: 'Other', percent: 23, color: colors.border },
  ],
  summary: 'You’re a certified boba girlie. 15 boba deals this month.',
};

export type Friend = { name: string; initials: string; tone: AvatarTone };
export type AvatarTone = 'ink' | 'orange' | 'soft' | 'muted';

export type FriendPost = {
  id: string;
  friend: Friend;
  verb: string;
  subject: string;
  ago: string;
  likes: number;
  comments: number;
  /** The deal or event the post is about; posts without one (rank changes) show no card. */
  card?: { id: string; kind: 'deal' | 'event'; title: string; subtitle: string };
};

export const FRIEND_POSTS: FriendPost[] = [
  {
    id: 'p1',
    friend: { name: 'Jess', initials: 'JL', tone: 'ink' },
    verb: 'used',
    subject: 'BOGO milk tea',
    ago: '2h',
    likes: 12,
    comments: 3,
    card: { id: 'tapioca-lab-bogo', kind: 'deal', title: 'BOGO milk tea', subtitle: 'Tapioca Lab · ends 6 PM' },
  },
  {
    id: 'p2',
    friend: { name: 'Daniel', initials: 'DK', tone: 'soft' },
    verb: 'is going to',
    subject: 'KDA × Chicha',
    ago: '5h',
    likes: 12,
    comments: 3,
    card: { id: 'kda-chicha-popup', kind: 'event', title: 'KDA × Chicha pop-up', subtitle: 'Sat 12 PM · Sawtelle' },
  },
  {
    id: 'p3',
    friend: { name: 'Kevin', initials: 'KT', tone: 'orange' },
    verb: 'passed you on the',
    subject: 'Westwood leaderboard',
    ago: '1d',
    likes: 12,
    comments: 3,
  },
];

/** Credits, not cash: both people get this when an invited friend signs up and verifies. */
export const INVITES = { joined: 3, earned: 1500, reward: 500 };

/** The share sheet behind "Invite" (Profile) and the add-friends button (Friends). */
export function inviteFriends() {
  const message = `Join me on dibs: it finds the best deals near you before they’re gone. We both get ${INVITES.reward} credits.`;
  Share.share({ message }).catch(() => undefined);
}

export type Scope = 'Friends' | 'Westwood' | 'UCLA';
export const SCOPES: Scope[] = ['Friends', 'Westwood', 'UCLA'];

/** The two rank cards on Friends and Profile (Figma "Rankings", 115:2598). */
export const RANK_CARDS: { scope: Exclude<Scope, 'Friends'>; icon: IconName }[] = [
  { scope: 'Westwood', icon: 'pin' },
  { scope: 'UCLA', icon: 'student' },
];

/** A few of your friends with their rank in each area, for the Friends tab list ("You" sits among them). */
export type RankedFriend = Friend & { rank: number; saved: number; you?: boolean };
export const FRIEND_RANKS: Record<Exclude<Scope, 'Friends'>, RankedFriend[]> = {
  Westwood: [
    { name: 'Kevin T.', initials: 'KT', tone: 'orange', rank: 3, saved: 486 },
    { name: 'Ana N.', initials: 'AN', tone: 'muted', rank: 9, saved: 402 },
    { name: 'Jess L.', initials: 'JL', tone: 'ink', rank: 11, saved: 377 },
    { name: 'You', initials: 'MR', tone: 'orange', rank: 14, saved: 312, you: true },
    { name: 'Daniel K.', initials: 'DK', tone: 'soft', rank: 17, saved: 288 },
  ],
  UCLA: [
    { name: 'Kevin T.', initials: 'KT', tone: 'orange', rank: 2, saved: 486 },
    { name: 'Ana N.', initials: 'AN', tone: 'muted', rank: 21, saved: 402 },
    { name: 'Jess L.', initials: 'JL', tone: 'ink', rank: 29, saved: 377 },
    { name: 'You', initials: 'MR', tone: 'orange', rank: 38, saved: 312, you: true },
    { name: 'Daniel K.', initials: 'DK', tone: 'soft', rank: 44, saved: 288 },
  ],
};

/** Profile's "Friends · 128" avatar row (Figma 115:2569). */
export const PROFILE_FRIENDS: Friend[] = [
  { name: 'Jess', initials: 'JL', tone: 'ink' },
  { name: 'Daniel', initials: 'DK', tone: 'soft' },
  { name: 'Priya', initials: 'PS', tone: 'muted' },
  { name: 'Kevin', initials: 'KT', tone: 'orange' },
  { name: 'Ana', initials: 'AN', tone: 'muted' },
  { name: 'Leo', initials: 'LG', tone: 'soft' },
  { name: 'Ria', initials: 'RB', tone: 'muted' },
];

export type Ranked = { name: string; initials: string; saved: number; change: number };

/** `toNext` is how many dollars short of the person one rank above you are; `top` is your percentile. */
export const LEADERBOARDS: Record<
  Scope,
  { ranked: Ranked[]; you: { rank: number; change: number; toNext: number; top: number } }
> = {
  Westwood: {
    ranked: [
      { name: 'Kevin T.', initials: 'KT', saved: 486, change: 0 },
      { name: 'Sofia M.', initials: 'SM', saved: 451, change: 1 },
      { name: 'Jordan P.', initials: 'JP', saved: 430, change: -1 },
      { name: 'Ana N.', initials: 'AN', saved: 402, change: 2 },
      { name: 'Leo G.', initials: 'LG', saved: 398, change: 0 },
      { name: 'Grace L.', initials: 'GL', saved: 391, change: 3 },
      { name: 'Chris W.', initials: 'CW', saved: 371, change: -2 },
      { name: 'Hana K.', initials: 'HK', saved: 360, change: 1 },
      { name: 'Omar R.', initials: 'OR', saved: 344, change: 0 },
      { name: 'Ben S.', initials: 'BS', saved: 330, change: -1 },
    ],
    you: { rank: 14, change: 3, toNext: 90, top: 3 },
  },
  Friends: {
    ranked: [
      { name: 'Jess L.', initials: 'JL', saved: 341, change: 1 },
      { name: 'Daniel K.', initials: 'DK', saved: 298, change: 0 },
      { name: 'Priya S.', initials: 'PS', saved: 276, change: 2 },
      { name: 'Tom H.', initials: 'TH', saved: 205, change: -1 },
      { name: 'Ivy C.', initials: 'IC', saved: 188, change: 0 },
    ],
    you: { rank: 2, change: 1, toNext: 29, top: 2 },
  },
  UCLA: {
    ranked: [
      { name: 'Riley A.', initials: 'RA', saved: 612, change: 0 },
      { name: 'Kevin T.', initials: 'KT', saved: 486, change: 1 },
      { name: 'Sam P.', initials: 'SP', saved: 470, change: -1 },
      { name: 'Sofia M.', initials: 'SM', saved: 451, change: 2 },
      { name: 'Jordan P.', initials: 'JP', saved: 430, change: 0 },
    ],
    you: { rank: 38, change: 5, toNext: 12, top: 5 },
  },
};

/** Days until the leaderboard resets on the 1st of next month. */
export function daysUntilReset(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.ceil((next.getTime() - now.getTime()) / 86_400_000);
}

export type SavedList = { name: string; icon: IconName; spots: number; tone: 'orange' | 'soft' | 'muted' };

export const SAVED_LISTS: SavedList[] = [
  { name: 'Want to try', icon: 'bookmark', spots: 12, tone: 'orange' },
  { name: 'Cheap eats', icon: 'burger', spots: 8, tone: 'soft' },
  { name: 'Glow up', icon: 'nails', spots: 5, tone: 'muted' },
];
