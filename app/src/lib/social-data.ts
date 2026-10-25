// Profile, Friends and Leaderboard numbers in the shapes the screens use (src/lib/social.ts): live from Convex
// in backend mode, the mock constants otherwise.
import { useQuery } from 'convex/react';

import { api } from '@convex/_generated/api';
import type { IconName } from '@/components/icon';
import { schoolName } from '@/lib/account';
import { usingBackend } from '@/lib/backend';
import { shortAgo } from '@/lib/format';
import {
  DEAL_DNA,
  FRIEND_POSTS,
  FRIEND_RANKS,
  INVITES,
  LEADERBOARDS,
  PROFILE_FRIENDS,
  PROFILE_STATS,
  RANK_CARDS,
  type AvatarTone,
  type Friend,
  type FriendPost,
  type Ranked,
  type RankedFriend,
} from '@/lib/social';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/use-now';
import { colors } from '@/theme';

const DNA_COLORS = [colors.orange, colors.orangeDeep, colors.pinDay, colors.pinWeek];
const TONES: AvatarTone[] = ['ink', 'soft', 'muted', 'orange'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Stable avatar colour per person. */
export function toneFor(id: string): AvatarTone {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

/** The two area boards: your neighbourhood and your school ("Westwood" and "UCLA" in the design). */
export type AreaKey = 'neighborhood' | 'school';
export type RankCard = { key: AreaKey; label: string; icon: IconName; rank: number | null; change: number; top: number | null };

export type SocialData = {
  stats: { savedDollars: number; joinedMonth: string; weeklySaved: number[]; dealsUsed: number; friends: number };
  dealDna: { slices: { label: string; percent: number; color: string }[]; summary: string };
  posts: FriendPost[];
  invites: { joined: number; earned: number; reward: number; code: string | null };
  rankCards: RankCard[];
  friendFaces: Friend[];
};

function useBackendSocial(): SocialData {
  const stats = useQuery(api.profile.stats);
  const feed = useQuery(api.social.feed);
  const area = useQuery(api.leaderboards.board, { scope: 'neighborhood' });
  const school = useQuery(api.leaderboards.board, { scope: 'school' });
  const me = useQuery(api.users.me);
  const { used } = useStore();
  const now = useNow(60_000).getTime();
  const joined = stats ? new Date(stats.joined_at) : null;
  const card = (key: AreaKey, label: string, icon: IconName, board: typeof area): RankCard => ({
    key,
    label,
    icon,
    rank: board?.you?.rank ?? null,
    change: board?.you?.change ?? 0,
    top: board?.you?.percentile ?? null,
  });
  return {
    stats: {
      savedDollars: Math.round((stats?.saved_cents ?? 0) / 100),
      joinedMonth: joined ? MONTHS[joined.getMonth()] : '',
      weeklySaved: (stats?.weekly_saved_cents ?? [0, 0, 0, 0, 0, 0, 0]).map((c) => Math.round(c / 100)),
      dealsUsed: Math.max(stats?.deals_used ?? 0, used.size),
      friends: stats?.friends ?? 0,
    },
    dealDna: {
      slices: (stats?.deal_dna.slices ?? []).map((s, i) => ({
        label: s.label,
        percent: s.percent,
        color: s.label === 'Other' ? colors.border : DNA_COLORS[i % DNA_COLORS.length],
      })),
      summary: stats?.deal_dna.summary ?? '',
    },
    posts: (feed ?? []).map((a) => ({
      id: a.id,
      friend: { name: a.friend.name, initials: a.friend.initials, tone: toneFor(a.friend.id) },
      verb: a.verb,
      subject: a.subject,
      ago: shortAgo(Math.max(0, (now - a.created_at) / 3_600_000)),
      // The screen adds one for your own like, so the count here leaves it out.
      likes: a.likes - (a.cheered ? 1 : 0),
      comments: 0,
      card: a.card ?? undefined,
    })),
    invites: {
      joined: stats?.invites.joined ?? 0,
      earned: stats?.invites.earned ?? 0,
      reward: stats?.invites.reward ?? INVITES.reward,
      code: stats?.invites.code ?? null,
    },
    rankCards: [
      card('neighborhood', me?.home_neighborhood ?? 'Your area', 'pin', area),
      card('school', me?.school ? schoolName(me.school) : 'Your school', 'student', school),
    ],
    friendFaces: (stats?.friend_faces ?? []).map((f) => ({ name: f.name, initials: f.initials, tone: toneFor(f.id) })),
  };
}

function useMockSocial(): SocialData {
  const { used } = useStore();
  return {
    stats: { ...PROFILE_STATS, dealsUsed: PROFILE_STATS.dealsUsed + used.size },
    dealDna: DEAL_DNA,
    posts: FRIEND_POSTS,
    invites: { ...INVITES, code: null },
    rankCards: RANK_CARDS.map(({ scope, icon }, i) => {
      const { rank, change, top } = LEADERBOARDS[scope].you;
      return { key: i === 0 ? 'neighborhood' : 'school', label: scope, icon, rank, change, top };
    }),
    friendFaces: PROFILE_FRIENDS,
  };
}

export const useSocial: () => SocialData = usingBackend ? useBackendSocial : useMockSocial;

// ---------------------------------------------------------------- friends' ranks (Friends tab list)

function useBackendFriendRanks(key: AreaKey): RankedFriend[] {
  const rows = useQuery(api.leaderboards.friendRanks, { scope: key });
  return (rows ?? []).map((r) => ({
    name: r.you ? 'You' : r.name,
    initials: r.initials,
    tone: r.you ? 'orange' : toneFor(r.id),
    rank: r.rank,
    saved: Math.round(r.saved_cents / 100),
    you: r.you || undefined,
  }));
}

function useMockFriendRanks(key: AreaKey): RankedFriend[] {
  return FRIEND_RANKS[key === 'neighborhood' ? 'Westwood' : 'UCLA'];
}

export const useFriendRanks: (key: AreaKey) => RankedFriend[] = usingBackend ? useBackendFriendRanks : useMockFriendRanks;

// ---------------------------------------------------------------- leaderboard

export type BoardScope = 'friends' | AreaKey;
export const BOARD_SCOPES: BoardScope[] = ['friends', 'neighborhood', 'school'];

export type BoardData = {
  /** Labels for the segmented control, in BOARD_SCOPES order. */
  labels: string[];
  ranked: Ranked[];
  you: { rank: number; change: number; saved: number; toNext: number; top: number } | null;
};

function useBackendBoard(scope: BoardScope): BoardData {
  const me = useQuery(api.users.me);
  const board = useQuery(api.leaderboards.board, { scope });
  return {
    labels: ['Friends', me?.home_neighborhood ?? 'Your area', me?.school ? schoolName(me.school) : 'Your school'],
    ranked: (board?.ranked ?? []).map((r) => ({ name: r.name, initials: r.initials, saved: Math.round(r.saved_cents / 100), change: r.change })),
    you: board?.you
      ? {
          rank: board.you.rank,
          change: board.you.change,
          saved: Math.round(board.you.saved_cents / 100),
          toNext: Math.round(board.you.to_next_cents / 100),
          top: board.you.percentile,
        }
      : null,
  };
}

const MOCK_SCOPE = { friends: 'Friends', neighborhood: 'Westwood', school: 'UCLA' } as const;

function useMockBoard(scope: BoardScope): BoardData {
  const board = LEADERBOARDS[MOCK_SCOPE[scope]];
  return {
    labels: ['Friends', 'Westwood', 'UCLA'],
    ranked: board.ranked,
    you: { ...board.you, saved: PROFILE_STATS.savedDollars },
  };
}

export const useBoard: (scope: BoardScope) => BoardData = usingBackend ? useBackendBoard : useMockBoard;

/** Leaderboard links pass a scope as a label ("Westwood", "UCLA", "Friends") or a key; map it to a key. */
export function scopeFromParam(param: string | undefined, labels: string[]): BoardScope {
  if (!param) return 'neighborhood';
  if ((BOARD_SCOPES as string[]).includes(param)) return param as BoardScope;
  const i = labels.findIndex((l) => l.toLowerCase() === param.toLowerCase());
  if (i >= 0) return BOARD_SCOPES[i]!;
  return param === 'Friends' ? 'friends' : param === 'UCLA' ? 'school' : 'neighborhood';
}
