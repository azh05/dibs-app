// Profile, leaderboard and friends numbers in the shapes the screens already use (src/lib/social.ts):
// live from Convex in backend mode, the mock constants otherwise.
import { useQuery } from 'convex/react';

import { api } from '@convex/_generated/api';
import { iconOr } from '@/components/icon';
import { schoolName } from '@/lib/account';
import { usingBackend } from '@/lib/backend';
import { shortAgo } from '@/lib/format';
import {
  BADGE_TOTAL,
  BADGES,
  BADGES_EARNED,
  DEAL_DNA,
  FRIEND_ACTIVITY,
  INVITES,
  LEADERBOARDS,
  PROFILE_STATS,
  WEEKLY_CHALLENGE,
  type AvatarTone,
  type Badge,
  type FriendActivity,
  type Ranked,
} from '@/lib/social';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/use-now';
import { colors } from '@/theme';

const DNA_COLORS = [colors.orange, colors.orangeDeep, colors.pinDay, colors.pinWeek];
const TONES: AvatarTone[] = ['ink', 'soft', 'muted', 'orange'];

export type ProfileData = {
  stats: { savedDollars: number; dealsUsed: number; weekStreak: number; friends: number };
  badges: Badge[];
  badgesEarned: number;
  badgeTotal: number;
  dealDna: { slices: { label: string; percent: number; color: string }[]; summary: string };
  friendActivity: FriendActivity[];
  invites: { joined: number; earned: number; reward: number; code: string | null };
  rank: { rank: number | null; where: string; percentile: number | null };
  /** Credits, for the invite card ("you both get 500 credits"). */
  rewardLabel: string;
};

function tone(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

function useBackendProfile(): ProfileData {
  const stats = useQuery(api.profile.stats);
  const feed = useQuery(api.social.feed);
  const board = useQuery(api.leaderboards.board, { scope: 'neighborhood' });
  const { used } = useStore();
  const now = useNow(60_000).getTime();
  const slices = (stats?.deal_dna.slices ?? []).map((s, i) => ({
    label: s.label,
    percent: s.percent,
    color: s.label === 'Other' ? colors.border : DNA_COLORS[i % DNA_COLORS.length],
  }));
  return {
    stats: {
      savedDollars: Math.round((stats?.saved_cents ?? 0) / 100),
      dealsUsed: Math.max(stats?.deals_used ?? 0, used.size),
      weekStreak: stats?.week_streak ?? 0,
      friends: stats?.friends ?? 0,
    },
    badges: (stats?.badges ?? [])
      .slice()
      .sort((a, b) => Number(b.featured) - Number(a.featured) || Number(b.earned) - Number(a.earned))
      .slice(0, 5)
      .map((b) => ({ name: b.name, icon: iconOr(b.icon), earned: b.earned, featured: b.featured })),
    badgesEarned: stats?.badges_earned ?? 0,
    badgeTotal: stats?.badge_total ?? BADGE_TOTAL,
    dealDna: { slices, summary: stats?.deal_dna.summary ?? '' },
    friendActivity: (feed ?? []).map((a) => ({
      id: a.id,
      friend: { name: a.friend.name, initials: a.friend.initials, tone: tone(a.friend.id) },
      verb: a.verb,
      subject: a.subject,
      place: a.place ?? undefined,
      ago: shortAgo(Math.max(0, (now - a.created_at) / 3_600_000)),
      savesId: a.type === 'earned_badge' ? undefined : (a.deal_id ?? undefined),
      action: a.type === 'earned_badge' ? 'cheer' : 'save',
    })),
    invites: {
      joined: stats?.invites.joined ?? 0,
      earned: stats?.invites.earned ?? 0,
      reward: stats?.invites.reward ?? 500,
      code: stats?.invites.code ?? null,
    },
    rank: { rank: board?.you?.rank ?? null, where: board?.label ?? 'your area', percentile: board?.you?.percentile ?? null },
    rewardLabel: `${stats?.invites.reward ?? 500} credits`,
  };
}

function useMockProfile(): ProfileData {
  const { used } = useStore();
  return {
    stats: { ...PROFILE_STATS, dealsUsed: PROFILE_STATS.dealsUsed + used.size },
    badges: BADGES,
    badgesEarned: BADGES_EARNED,
    badgeTotal: BADGE_TOTAL,
    dealDna: DEAL_DNA,
    friendActivity: FRIEND_ACTIVITY,
    invites: { ...INVITES, reward: 500, earned: INVITES.joined * 500, code: null },
    rank: { rank: LEADERBOARDS.Westwood.you.rank, where: 'Westwood', percentile: 3 },
    rewardLabel: '500 credits',
  };
}

export const useProfile: () => ProfileData = usingBackend ? useBackendProfile : useMockProfile;

// ---------------------------------------------------------------- leaderboard

export type BoardData = {
  scopes: string[];
  ranked: Ranked[];
  you: { rank: number; change: number; saved: number } | null;
  challenge: { title: string; reward: number; done: number; goal: number } | null;
};

const SCOPE_KEYS = ['friends', 'neighborhood', 'school'] as const;

function useBackendBoard(scopeIndex: number): BoardData {
  const me = useQuery(api.users.me);
  const scope = SCOPE_KEYS[scopeIndex] ?? 'friends';
  const board = useQuery(api.leaderboards.board, { scope });
  const challenges = useQuery(api.challenges.current);
  const scopes = ['Friends', me?.home_neighborhood ?? 'Neighborhood', me?.school ? schoolName(me.school) : 'School'];
  const c = challenges?.[0];
  return {
    scopes,
    ranked: (board?.ranked ?? []).map((r) => ({ name: r.name, initials: r.initials, saved: Math.round(r.saved_cents / 100), change: r.change })),
    you: board?.you ? { rank: board.you.rank, change: board.you.change, saved: Math.round(board.you.saved_cents / 100) } : null,
    challenge: c ? { title: c.title, reward: c.reward, done: c.done, goal: c.goal } : null,
  };
}

function useMockBoard(scopeIndex: number): BoardData {
  const scopes = ['Friends', 'Westwood', 'UCLA'] as const;
  const board = LEADERBOARDS[scopes[scopeIndex] ?? 'Westwood'];
  return {
    scopes: [...scopes],
    ranked: board.ranked,
    you: { ...board.you, saved: PROFILE_STATS.savedDollars },
    challenge: WEEKLY_CHALLENGE,
  };
}

export const useBoard: (scopeIndex: number) => BoardData = usingBackend ? useBackendBoard : useMockBoard;
