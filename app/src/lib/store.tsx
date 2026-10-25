// In-memory app state: account, interests and alerts, browse filters, saved and used deals,
// line reports and XP. Nothing is persisted yet; it resets when the app restarts.
import { createContext, useContext, useState, type ReactNode } from 'react';

import { ageOn, type Account } from '@/lib/account';
import { DEFAULT_FILTERS, type Filters } from '@/lib/filters';
import { DEFAULT_INTERESTS } from '@/lib/interests';
import { REPORT_XP, type LineReport } from '@/lib/line-check';
import { MOCK_ACTIVITY, MOCK_CREDITS, MOCK_SUBMISSIONS } from '@/lib/mock';
import { STARTING_XP } from '@/lib/social';
import type { Activity, Submission } from '@/lib/types';

type Store = {
  account: Account | null;
  signIn: (account: Account) => void;
  signOut: () => void;
  /** Verified .edu domain, from Sign in, Create account or Profile. */
  studentDomain: string | null;
  setStudentDomain: (domain: string) => void;
  /** 21+ sections unlock once the account's birthday says so. */
  adultUnlocked: boolean;
  unlockAdult: () => 'unlocked' | 'too-young' | 'no-birthday';

  saved: Set<string>;
  toggleSaved: (id: string) => void;
  used: Set<string>;
  markUsed: (id: string) => void;
  followed: Set<string>;
  toggleFollowed: (store: string) => void;
  reminders: Set<string>;
  toggleReminder: (eventId: string) => void;
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

  filters: Filters;
  setFilters: (filters: Filters) => void;

  activity: Activity[];
  markRead: (id: string) => void;
  submissions: Submission[];
  addSubmission: (s: Submission) => void;
  /** dibs credits earned from verified submissions. */
  credits: number;

  lineReports: LineReport[];
  reportLine: (dealId: string, minutes: number) => LineReport;
  undoLineReport: (report: LineReport) => void;
  xp: number;
};

const StoreContext = createContext<Store | null>(null);

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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [studentDomain, setStudentDomain] = useState<string | null>(null);
  const [adultUnlocked, setAdultUnlocked] = useState(false);
  const [saved, toggleSaved] = useToggleSet(SEEDED_SAVES);
  const [used, , setUsed] = useToggleSet();
  const [followed, toggleFollowed] = useToggleSet(['Tapioca Lab', 'Polish Bar']);
  const [reminders, toggleReminder] = useToggleSet(['kda-chicha-popup']);
  const [liked, toggleLiked] = useToggleSet();
  const [instant, setInstant] = useState(true);
  const [topics, toggleTopic, setTopicsOn] = useToggleSet(DEFAULT_INTERESTS);
  const [alertRadiusMi, setAlertRadiusMi] = useState(1);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [activity, setActivity] = useState(MOCK_ACTIVITY);
  const [submissions, setSubmissions] = useState(MOCK_SUBMISSIONS);
  const [lineReports, setLineReports] = useState<LineReport[]>([]);
  const [xp, setXp] = useState(STARTING_XP);

  const value: Store = {
    account,
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
    unlockAdult: () => {
      if (!account?.birthday) return 'no-birthday';
      if (ageOn(account.birthday) < 21) return 'too-young';
      setAdultUnlocked(true);
      return 'unlocked';
    },
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
    filters,
    setFilters,
    activity,
    markRead: (id) => setActivity((list) => list.map((a) => (a.id === id ? { ...a, unread: false } : a))),
    submissions,
    addSubmission: (s) => setSubmissions((list) => [s, ...list]),
    credits: MOCK_CREDITS,
    lineReports,
    reportLine: (dealId, minutes) => {
      const report = { dealId, minutes, at: Date.now() };
      setLineReports((list) => [...list, report]);
      setXp((n) => n + REPORT_XP);
      return report;
    },
    undoLineReport: (report) => {
      setLineReports((list) => list.filter((r) => r !== report));
      setXp((n) => n - REPORT_XP);
    },
    xp,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
}
