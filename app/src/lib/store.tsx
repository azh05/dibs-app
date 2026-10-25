// App state behind one hook, useStore(). Two implementations share this interface:
// - mock mode (this file): in memory, seeded from src/lib/mock.ts and src/lib/social.ts; resets on restart.
// - backend mode (src/lib/backend-store.tsx): Convex queries and mutations, signed in with Clerk.
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';

import { ageOn, type Account } from '@/lib/account';
import { DEFAULT_FILTERS, type Filters } from '@/lib/filters';
import { DEFAULT_INTERESTS } from '@/lib/interests';
import { REPORT_XP, type LineReport } from '@/lib/line-check';
import { HOME, MOCK_ACTIVITY, MOCK_CREDITS, MOCK_SUBMISSIONS } from '@/lib/mock';
import { SAVED_LISTS, STARTING_XP } from '@/lib/social';
import type { Activity, Deal, LatLng, Submission } from '@/lib/types';

export type AdultResult = 'unlocked' | 'too-young' | 'no-birthday';

/** Where the feed is centred: the primary saved location, or Westwood until there is one. */
export type Place = { label: string; coords: LatLng; areaKey: string | null };

export type NewPlace = {
  label: string;
  coords: LatLng;
  neighborhood?: string;
  city?: string;
  region?: string;
};

export type SavedList = { id: string; name: string; icon: string | null; spots: number };

export type Store = {
  account: Account | null;
  /** Signed in (backend: Clerk session; mock: the demo account). Welcome and Sign in skip ahead when true. */
  signedIn: boolean;
  signIn: (account: Account) => void;
  signOut: () => void;
  /** Verified .edu domain, from Sign in, Create account or Profile. */
  studentDomain: string | null;
  setStudentDomain: (domain: string) => void;
  /** 21+ sections unlock once the account's birthday says so. */
  adultUnlocked: boolean;
  unlockAdult: () => Promise<AdultResult>;
  /** YYYY-MM-DD; asked for by the 21+ check when the account has none (e.g. phone sign-up). */
  setBirthday: (birthday: string) => Promise<void>;
  /** Invite code for the referral link (backend only). */
  referralCode: string | null;
  /** Signed in without a username yet (e.g. Apple, Google or phone sign-up): the tabs send them to pick one. */
  needsUsername: boolean;
  /** Name and username from "Pick a username"; rejects when the username is taken. */
  saveProfile: (profile: { name: string; username: string }) => Promise<void>;

  saved: Set<string>;
  toggleSaved: (id: string) => void;
  used: Set<string>;
  markUsed: (id: string, savedCents?: number) => void;
  /** Followed stores: store ids in backend mode, store names in mock mode (see followKey). */
  followed: Set<string>;
  toggleFollowed: (key: string) => void;
  reminders: Set<string>;
  toggleReminder: (id: string) => void;
  /** Friends posts you liked. */
  liked: Set<string>;
  toggleLiked: (postId: string) => void;

  instant: boolean;
  setInstant: (on: boolean) => void;
  topics: Set<string>;
  toggleTopic: (topic: string) => void;
  /** Turn a group of topics on or off at once ("Select all"). */
  setTopicsOn: (topics: string[], on: boolean) => void;
  alertRadiusMi: number;
  setAlertRadiusMi: (mi: number) => void;
  place: Place;
  savePlace: (place: NewPlace) => Promise<void>;

  filters: Filters;
  setFilters: (filters: Filters) => void;

  activity: Activity[];
  markRead: (id: string) => void;
  submissions: Submission[];
  addSubmission: (s: Submission) => void;
  /** Posted dibs credits, and credits still waiting on the 24-hour check. */
  credits: { balance: number; pending: number };

  lineReports: LineReport[];
  reportLine: (deal: Deal, minutes: number, position: LatLng | null) => LineReport;
  undoLineReport: (report: LineReport) => void;
  xp: number;

  vote: (dealId: string, value: -1 | 0 | 1) => void;
  /** "Still running?" on a deal: yes or it ended. */
  confirmDeal: (dealId: string, kind: 'still_running' | 'ended') => void;
  confirmedToday: Set<string>;

  lists: SavedList[];
  createList: (name: string) => void;
  addToList: (listId: string, dealId: string) => void;
};

export const StoreContext = createContext<Store | null>(null);

/** The key follows use for a deal's store. */
export function followKey(deal: { storeId?: string; store: string }) {
  return deal.storeId ?? deal.store;
}

function useToggleSet(initial: string[] = []) {
  const [set, setSet] = useState(() => new Set(initial));
  const toggle = (key: string) =>
    setSet((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setMany = (keys: string[], on: boolean) =>
    setSet((s) => {
      const next = new Set(s);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  return [set, toggle, setMany] as const;
}

/** A few saves so Saved and Profile have something to show on first launch. */
const SEEDED_SAVES = [
  'tapioca-lab-bogo',
  'polish-bar-gel',
  'iron-pulse-month',
  'scoops-cones',
  'morning-grind-lattes',
  'kda-chicha-popup',
];

export function MockStoreProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  // The 21+ check runs right after setBirthday, before state re-renders.
  const birthdayRef = useRef<string | null>(null);
  const [studentDomain, setStudentDomain] = useState<string | null>(null);
  const [adultUnlocked, setAdultUnlocked] = useState(false);
  const [saved, toggleSaved] = useToggleSet(SEEDED_SAVES);
  const [used, , setUsed] = useToggleSet();
  const [followed, toggleFollowed] = useToggleSet(['Tapioca Lab', 'Polish Bar']);
  const [reminders, toggleReminder] = useToggleSet(['kda-chicha-popup']);
  const [liked, toggleLiked] = useToggleSet();
  const [confirmedToday, , setConfirmed] = useToggleSet();
  const [instant, setInstant] = useState(true);
  const [topics, toggleTopic, setTopicsOn] = useToggleSet(DEFAULT_INTERESTS);
  const [alertRadiusMi, setAlertRadiusMi] = useState(1);
  const [place, setPlace] = useState<Place>({ label: HOME.label, coords: HOME, areaKey: null });
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [activity, setActivity] = useState(MOCK_ACTIVITY);
  const [submissions, setSubmissions] = useState(MOCK_SUBMISSIONS);
  const [lineReports, setLineReports] = useState<LineReport[]>([]);
  const [xp, setXp] = useState(STARTING_XP);
  const [lists, setLists] = useState<SavedList[]>(() =>
    SAVED_LISTS.map((l, i) => ({ id: `list-${i}`, name: l.name, icon: l.icon, spots: l.spots })),
  );

  const value: Store = {
    account,
    signedIn: account !== null,
    signIn: (a) => {
      setAccount(a);
      if (a.studentDomain) setStudentDomain(a.studentDomain);
    },
    signOut: () => {
      setAccount(null);
      setStudentDomain(null);
      setAdultUnlocked(false);
    },
    studentDomain,
    setStudentDomain,
    adultUnlocked,
    unlockAdult: async () => {
      const birthday = birthdayRef.current ?? account?.birthday;
      if (!birthday) return 'no-birthday';
      if (ageOn(birthday) < 21) return 'too-young';
      setAdultUnlocked(true);
      return 'unlocked';
    },
    setBirthday: async (birthday) => {
      birthdayRef.current = birthday;
      setAccount((a) => (a ? { ...a, birthday } : a));
    },
    referralCode: null,
    needsUsername: false,
    saveProfile: async ({ name, username }) => setAccount((a) => (a ? { ...a, name, username } : a)),
    saved,
    toggleSaved,
    used,
    markUsed: (id) => setUsed([id], true),
    followed,
    toggleFollowed,
    reminders,
    toggleReminder,
    liked,
    toggleLiked,
    instant,
    setInstant,
    topics,
    toggleTopic,
    setTopicsOn,
    alertRadiusMi,
    setAlertRadiusMi,
    place,
    savePlace: async (p) => setPlace({ label: p.label, coords: p.coords, areaKey: null }),
    filters,
    setFilters,
    activity,
    markRead: (id) => setActivity((list) => list.map((a) => (a.id === id ? { ...a, unread: false } : a))),
    submissions,
    addSubmission: (s) => setSubmissions((list) => [s, ...list]),
    credits: { balance: MOCK_CREDITS, pending: 500 },
    lineReports,
    reportLine: (deal, minutes) => {
      const report = { dealId: deal.id, minutes, at: Date.now() };
      setLineReports((list) => [...list, report]);
      setXp((n) => n + REPORT_XP);
      return report;
    },
    undoLineReport: (report) => {
      setLineReports((list) => list.filter((r) => r !== report));
      setXp((n) => n - REPORT_XP);
    },
    xp,
    vote: () => undefined,
    confirmDeal: (dealId) => setConfirmed([dealId], true),
    confirmedToday,
    lists,
    createList: (name) => setLists((l) => [...l, { id: `list-${Date.now()}`, name, icon: 'bookmark', spots: 0 }]),
    addToList: (listId) => setLists((l) => l.map((x) => (x.id === listId ? { ...x, spots: x.spots + 1 } : x))),
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside a store provider');
  return store;
}
