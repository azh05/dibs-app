// Profile, leaderboard and friends data (Figma "5 · Profile & social"). There is no social
// backend yet, so everything here is mock data shaped like the screens.
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

export const PROFILE_STATS = { savedDollars: 312, dealsUsed: 48, weekStreak: 6, friends: 128 };

export type Badge = { name: string; icon: IconName; earned: boolean; featured?: boolean };

export const BADGES: Badge[] = [
  { name: 'Boba Boss', icon: 'boba', earned: true, featured: true },
  { name: 'Early Bird', icon: 'zap', earned: true },
  { name: 'Scout', icon: 'camera', earned: true },
  { name: 'Glow Getter', icon: 'nails', earned: true },
  { name: 'Night Owl', icon: 'lock', earned: false },
];

export const BADGE_TOTAL = 24;
export const BADGES_EARNED = 5;

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

export type FriendActivity = {
  id: string;
  friend: Friend;
  verb: string;
  subject: string;
  place?: string;
  ago: string;
  /** Saving it adds this deal or event to your own saved list. */
  savesId?: string;
  action: 'save' | 'cheer';
};

export const FRIEND_ACTIVITY: FriendActivity[] = [
  {
    id: 'f1',
    friend: { name: 'Jess', initials: 'JL', tone: 'ink' },
    verb: 'used',
    subject: 'BOGO milk tea',
    place: 'Tapioca Lab',
    ago: '2h',
    savesId: 'tapioca-lab-bogo',
    action: 'save',
  },
  {
    id: 'f2',
    friend: { name: 'Daniel', initials: 'DK', tone: 'soft' },
    verb: 'saved',
    subject: 'KDA × Chicha pop-up',
    ago: '5h',
    savesId: 'kda-chicha-popup',
    action: 'save',
  },
  {
    id: 'f3',
    friend: { name: 'Priya', initials: 'PS', tone: 'muted' },
    verb: 'unlocked',
    subject: 'Boba Boss',
    ago: '1d',
    action: 'cheer',
  },
];

export const INVITES = { joined: 3, earned: 15, reward: 5 };

export type Scope = 'Friends' | 'Westwood' | 'UCLA';
export const SCOPES: Scope[] = ['Friends', 'Westwood', 'UCLA'];

export type Ranked = { name: string; initials: string; saved: number; change: number };

export const LEADERBOARDS: Record<Scope, { ranked: Ranked[]; you: { rank: number; change: number } }> = {
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
    you: { rank: 14, change: 3 },
  },
  Friends: {
    ranked: [
      { name: 'Jess L.', initials: 'JL', saved: 341, change: 1 },
      { name: 'Daniel K.', initials: 'DK', saved: 298, change: 0 },
      { name: 'Priya S.', initials: 'PS', saved: 276, change: 2 },
      { name: 'Tom H.', initials: 'TH', saved: 205, change: -1 },
      { name: 'Ivy C.', initials: 'IC', saved: 188, change: 0 },
    ],
    you: { rank: 2, change: 1 },
  },
  UCLA: {
    ranked: [
      { name: 'Riley A.', initials: 'RA', saved: 612, change: 0 },
      { name: 'Kevin T.', initials: 'KT', saved: 486, change: 1 },
      { name: 'Sam P.', initials: 'SP', saved: 470, change: -1 },
      { name: 'Sofia M.', initials: 'SM', saved: 451, change: 2 },
      { name: 'Jordan P.', initials: 'JP', saved: 430, change: 0 },
    ],
    you: { rank: 37, change: 5 },
  },
};

export const WEEKLY_CHALLENGE = { title: 'Use 3 boba deals', reward: 150, done: 2, goal: 3 };

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
