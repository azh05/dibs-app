// In-memory app state (saved deals, follows, reminders, alert settings, submissions).
// Nothing is persisted yet; it resets when the app restarts.
import { createContext, useContext, useState, type ReactNode } from 'react';

import { MOCK_ACTIVITY, MOCK_EARNED, MOCK_SUBMISSIONS } from '@/lib/mock';
import type { Activity, Submission } from '@/lib/types';

type Store = {
  saved: Set<string>;
  toggleSaved: (id: string) => void;
  followed: Set<string>;
  toggleFollowed: (store: string) => void;
  reminders: Set<string>;
  toggleReminder: (eventId: string) => void;
  instant: boolean;
  setInstant: (on: boolean) => void;
  topics: Set<string>;
  toggleTopic: (topic: string) => void;
  /** Turn a group of topics on or off at once ("Select all"). */
  setTopicsOn: (topics: string[], on: boolean) => void;
  radiusMi: number;
  setRadiusMi: (mi: number) => void;
  activity: Activity[];
  markRead: (id: string) => void;
  submissions: Submission[];
  addSubmission: (s: Submission) => void;
  earned: number;
};

const StoreContext = createContext<Store | null>(null);

function toggle(set: Set<string>, key: string) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState(new Set<string>());
  const [followed, setFollowed] = useState(new Set<string>());
  const [reminders, setReminders] = useState(new Set(['kda-chicha-popup']));
  const [instant, setInstant] = useState(true);
  const [topics, setTopics] = useState(new Set(['Upcoming events', 'Restaurants', 'Boba & tea', 'Cafes', 'Fast food', 'Gyms']));
  const [radiusMi, setRadiusMi] = useState(1);
  const [activity, setActivity] = useState(MOCK_ACTIVITY);
  const [submissions, setSubmissions] = useState(MOCK_SUBMISSIONS);

  const value: Store = {
    saved,
    toggleSaved: (id) => setSaved((s) => toggle(s, id)),
    followed,
    toggleFollowed: (store) => setFollowed((s) => toggle(s, store)),
    reminders,
    toggleReminder: (id) => setReminders((s) => toggle(s, id)),
    instant,
    setInstant,
    topics,
    toggleTopic: (t) => setTopics((s) => toggle(s, t)),
    setTopicsOn: (list, on) =>
      setTopics((s) => {
        const next = new Set(s);
        for (const t of list) {
          if (on) next.add(t);
          else next.delete(t);
        }
        return next;
      }),
    radiusMi,
    setRadiusMi,
    activity,
    markRead: (id) => setActivity((list) => list.map((a) => (a.id === id ? { ...a, unread: false } : a))),
    submissions,
    addSubmission: (s) => setSubmissions((list) => [s, ...list]),
    earned: MOCK_EARNED,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
}
