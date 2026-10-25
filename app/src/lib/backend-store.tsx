// useStore() backed by Convex (app/convex). Toggles update the screen at once and are rolled back if the
// mutation fails; everything else is a live query, so it persists and syncs across devices.
import { useClerk } from '@clerk/expo';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { DEAL_TYPES as CATALOG_DEAL_TYPES, STORE_TYPES as CATALOG_STORE_TYPES } from '@convex/catalog';
import { errorText } from '@/lib/backend';
import { storeTypeLabel } from '@/lib/feed';
import { DEFAULT_FILTERS } from '@/lib/filters';
import { shortAgo } from '@/lib/format';
import { interestIcon } from '@/lib/interests';
import type { LineReport } from '@/lib/line-check';
import { HOME } from '@/lib/mock';
import { registerForPush } from '@/lib/push';
import { StoreContext, type Place, type Store } from '@/lib/store';
import type { Activity, Submission } from '@/lib/types';

const STORE_KEY = new Map(CATALOG_STORE_TYPES.map((t) => [t.label, t.key]));
const STORE_LABEL = new Map(CATALOG_STORE_TYPES.map((t) => [t.key, t.label]));
const DEAL_KEY = new Map<string, string>(CATALOG_DEAL_TYPES.map((t) => [t.label, t.key]));
const DEAL_LABEL = new Map<string, string>(CATALOG_DEAL_TYPES.map((t) => [t.key, t.label]));

type DealTypeKey = (typeof CATALOG_DEAL_TYPES)[number]['key'];

/** Profile fields from Create account (name, username, birthday, invite code). They're written once the users row
 * exists, right after sign-up completes. */
export type PendingProfile = { username?: string; display_name?: string; birthday?: string | null; referral_code?: string };
let pendingProfile: PendingProfile | null = null;
export function setPendingProfile(profile: PendingProfile) {
  pendingProfile = { ...pendingProfile, ...profile };
}
export function pendingUsername() {
  return pendingProfile?.username ?? '';
}
export function pendingReferralCode() {
  return pendingProfile?.referral_code ?? '';
}

/** A server-backed set with local, optimistic changes laid over it. Each change remembers what the server said
 * when it was made, and stops applying as soon as the server's answer for that key changes. */
function useOptimisticSet(server: string[] | undefined) {
  const [overrides, setOverrides] = useState<Map<string, { on: boolean; seen: boolean }>>(() => new Map());
  const base = useMemo(() => new Set(server ?? []), [server]);
  const set = useMemo(() => {
    const s = new Set(base);
    for (const [k, { on, seen }] of overrides) {
      if (base.has(k) !== seen) continue; // the server caught up (or changed elsewhere)
      if (on) s.add(k);
      else s.delete(k);
    }
    return s;
  }, [base, overrides]);
  const apply = (key: string, on: boolean) => setOverrides((o) => new Map(o).set(key, { on, seen: base.has(key) }));
  const revert = (key: string) =>
    setOverrides((o) => {
      const next = new Map(o);
      next.delete(key);
      return next;
    });
  return { set, apply, revert };
}

function fail(e: unknown) {
  Alert.alert('Something went wrong', errorText(e));
}

function hoursAgo(ms: number) {
  return Math.max(0, (Date.now() - ms) / 3_600_000);
}

export function BackendStoreProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const clerk = useClerk();
  const skip = isAuthenticated ? {} : ('skip' as const);

  const me = useQuery(api.users.me, skip);
  const saves = useQuery(api.saves.saved, skip);
  const followedStores = useQuery(api.prefs.followedStores, skip);
  const reminderRows = useQuery(api.reminders.mine, skip);
  const serverTopics = useQuery(api.prefs.topics, skip);
  const locations = useQuery(api.prefs.savedLocations, skip);
  const inbox = useQuery(api.notify.inbox, skip);
  const subs = useQuery(api.photos.mine, skip);
  const creditHistory = useQuery(api.credits.history, skip);
  const serverLists = useQuery(api.saves.lists, skip);
  const friendFeed = useQuery(api.social.feed, skip);

  const storeUser = useMutation(api.users.store);
  const updateProfile = useMutation(api.users.updateProfile);
  const unlockAdult = useMutation(api.users.unlockAdult);
  const toggleSave = useMutation(api.saves.toggleSave);
  const markUsed = useMutation(api.saves.markUsed);
  const setFollow = useMutation(api.prefs.setFollow);
  const setReminder = useMutation(api.reminders.set);
  const cancelReminder = useMutation(api.reminders.cancel);
  const react = useMutation(api.social.react);
  const setInstantAlerts = useMutation(api.prefs.setInstantAlerts);
  const setTopics = useMutation(api.prefs.setTopics);
  const setAlertRadius = useMutation(api.prefs.setAlertRadius);
  const saveLocation = useMutation(api.prefs.saveLocation);
  const markOpened = useMutation(api.notify.markOpened);
  const reportLine = useMutation(api.lineChecks.report);
  const undoLine = useMutation(api.lineChecks.undo);
  const vote = useMutation(api.community.vote);
  const confirm = useMutation(api.community.confirm);
  const createList = useMutation(api.saves.createList);
  const addToList = useMutation(api.saves.addToList);
  const registerDevice = useMutation(api.prefs.registerDevice);

  // Create the users row on sign-in, then register this device for push.
  const stored = useRef(false);
  useEffect(() => {
    if (!isAuthenticated) {
      stored.current = false;
      return;
    }
    if (stored.current) return;
    stored.current = true;
    storeUser({})
      .then(async () => {
        const profile = pendingProfile;
        pendingProfile = null;
        if (profile) await updateProfile(profile).catch(fail);
      })
      .then(() => registerForPush())
      .then((push) => push && registerDevice(push))
      .catch(() => undefined);
  }, [isAuthenticated, storeUser, registerDevice, updateProfile]);

  const saved = useOptimisticSet(saves?.map((s) => s.id));
  const used = useOptimisticSet(saves?.filter((s) => s.used_at).map((s) => s.id));
  const followed = useOptimisticSet(followedStores?.map((s) => s.id));
  const reminders = useOptimisticSet(reminderRows?.map((r) => r.deal_id));
  const cheered = useOptimisticSet(friendFeed?.filter((f) => f.cheered).map((f) => f.id));
  const [confirmedToday, setConfirmedToday] = useState(() => new Set<string>());

  const serverTopicLabels = useMemo(
    () =>
      serverTopics
        ? [
            ...serverTopics.store_types.map((k) => STORE_LABEL.get(k)).filter(Boolean),
            ...serverTopics.deal_types.map((k) => DEAL_LABEL.get(k)).filter(Boolean),
          ]
        : undefined,
    [serverTopics],
  ) as string[] | undefined;
  // Local picks apply until the server's list changes (i.e. our write landed).
  const serverTopicsKey = serverTopicLabels?.join('|') ?? '';
  const [localTopics, setLocalTopics] = useState<{ labels: Set<string>; seen: string } | null>(null);
  const topics =
    localTopics && localTopics.seen === serverTopicsKey ? localTopics.labels : new Set(serverTopicLabels ?? []);

  const writeTopics = (next: Set<string>) => {
    setLocalTopics({ labels: next, seen: serverTopicsKey });
    if (!isAuthenticated) return;
    const labels = [...next];
    setTopics({
      store_types: labels.map((l) => STORE_KEY.get(l)).filter((k): k is string => Boolean(k)),
      deal_types: labels.map((l) => DEAL_KEY.get(l)).filter((k): k is DealTypeKey => Boolean(k)) as DealTypeKey[],
    }).catch((e) => {
      setLocalTopics(null);
      fail(e);
    });
  };

  const primary = locations?.find((l) => l.is_primary) ?? locations?.[0];
  const place: Place = primary
    ? {
        label: primary.neighborhood ? [primary.neighborhood, primary.city === 'Los Angeles' ? 'LA' : primary.city].filter(Boolean).join(', ') : primary.label,
        coords: { latitude: primary.lat, longitude: primary.lng },
        areaKey: primary.scan_area_key,
      }
    : { label: HOME.label, coords: HOME, areaKey: null };
  const [localRadius, setLocalRadius] = useState<number | null>(null);
  const alertRadiusMi = localRadius ?? primary?.radius_miles ?? 1;
  const [localInstant, setLocalInstant] = useState<{ on: boolean; seen: boolean | undefined } | null>(null);
  const instant = localInstant && localInstant.seen === me?.instant_alerts ? localInstant.on : (me?.instant_alerts ?? true);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [lineReports, setLineReports] = useState<LineReport[]>([]);

  /** Signed-out taps on personal actions go to sign-in. */
  const needAccount = () => {
    if (isAuthenticated) return false;
    router.push('/onboarding/sign-in');
    return true;
  };

  const optimistic = (set: ReturnType<typeof useOptimisticSet>, key: string, on: boolean, run: () => Promise<unknown>) => {
    if (needAccount()) return;
    set.apply(key, on);
    run().catch((e) => {
      set.revert(key);
      fail(e);
    });
  };

  const activity: Activity[] = (inbox ?? []).map((n) => ({
    id: n.id,
    dealId: n.deal_id,
    icon: interestIcon(storeTypeLabel(n.store_type)),
    title: n.title,
    subtitle: n.subtitle,
    ago: shortAgo(hoursAgo(n.sent_at)),
    unread: n.unread,
  }));

  const submissions: Submission[] = (subs ?? []).map((s) => ({
    id: s.id,
    store: s.store ?? 'Your photo',
    offer: s.offer ?? (s.state === 'processing' ? 'Reading your photo…' : 'No deal found'),
    icon: interestIcon(storeTypeLabel(s.store_type)),
    status:
      s.state === 'processing'
        ? 'checking'
        : s.result === 'confirmed'
          ? 'verified'
          : s.result === 'needs_check'
            ? 'review'
            : 'rejected',
    photoUri: s.image_url ?? undefined,
    credits: s.credit,
  }));

  const value: Store = {
    account: me
      ? {
          name: me.display_name ?? me.username ?? 'dibs user',
          username: me.username ?? 'you',
          email: me.email ?? '',
          birthday: me.birthday,
          studentDomain: me.edu_verified ? me.school : null,
        }
      : null,
    signIn: (a) => {
      updateProfile({ username: a.username, display_name: a.name, birthday: a.birthday }).catch(fail);
    },
    signOut: () => {
      clerk.signOut().catch(fail);
    },
    studentDomain: me?.edu_verified ? me.school : null,
    setStudentDomain: () => undefined, // set by the Clerk webhook once the .edu address is verified
    adultUnlocked: Boolean(me?.adult_unlocked),
    unlockAdult: async () => {
      if (needAccount()) return 'no-birthday';
      return unlockAdult({});
    },
    setBirthday: async (birthday) => {
      if (needAccount()) return;
      await updateProfile({ birthday });
    },
    referralCode: me?.referral_code ?? null,

    saved: saved.set,
    toggleSaved: (id) => optimistic(saved, id, !saved.set.has(id), () => toggleSave({ dealId: id as Id<'deals'> })),
    used: used.set,
    markUsed: (id, cents) => {
      if (needAccount()) return;
      used.apply(id, true);
      saved.apply(id, true);
      markUsed({ dealId: id as Id<'deals'>, saved_cents: cents }).catch((e) => {
        used.revert(id);
        saved.revert(id);
        fail(e);
      });
    },
    followed: followed.set,
    toggleFollowed: (key) => {
      const on = !followed.set.has(key);
      optimistic(followed, key, on, () => setFollow({ storeId: key as Id<'stores'>, on }));
    },
    reminders: reminders.set,
    toggleReminder: (id) => {
      const on = !reminders.set.has(id);
      optimistic(reminders, id, on, () =>
        on ? setReminder({ dealId: id as Id<'deals'> }) : cancelReminder({ dealId: id as Id<'deals'> }),
      );
    },
    cheered: cheered.set,
    toggleCheer: (id) =>
      optimistic(cheered, id, !cheered.set.has(id), () => react({ activityId: id as Id<'activity'>, kind: 'cheer' })),

    instant,
    setInstant: (on) => {
      setLocalInstant({ on, seen: me?.instant_alerts });
      if (isAuthenticated) setInstantAlerts({ on }).catch(fail);
    },
    topics,
    toggleTopic: (topic) => {
      const next = new Set(topics);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      writeTopics(next);
    },
    setTopicsOn: (list, on) => {
      const next = new Set(topics);
      for (const t of list) {
        if (on) next.add(t);
        else next.delete(t);
      }
      writeTopics(next);
    },
    alertRadiusMi,
    setAlertRadiusMi: (mi) => {
      setLocalRadius(mi);
      if (isAuthenticated && primary) setAlertRadius({ radius_miles: mi }).catch(fail);
    },
    place,
    savePlace: async (p) => {
      if (needAccount()) return;
      await saveLocation({
        id: primary?._id,
        label: p.label,
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        neighborhood: p.neighborhood,
        city: p.city,
        region: p.region,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        radius_miles: alertRadiusMi,
        is_primary: true,
      });
    },

    filters,
    setFilters,

    activity,
    markRead: (id) => {
      if (isAuthenticated) markOpened({ id: id as Id<'notifications'> }).catch(() => undefined);
    },
    submissions,
    addSubmission: () => undefined, // submissions are rows in photo_submissions (see src/lib/photo.ts)
    credits: { balance: creditHistory?.balance ?? 0, pending: creditHistory?.pending ?? 0 },

    lineReports,
    reportLine: (deal, minutes, position) => {
      const report: LineReport = { dealId: deal.id, minutes, at: Date.now() };
      setLineReports((list) => [...list, report]);
      if (isAuthenticated && deal.storeId && position) {
        reportLine({ storeId: deal.storeId as Id<'stores'>, wait_minutes: minutes, lat: position.latitude, lng: position.longitude })
          .then(({ reportId }) => setLineReports((list) => list.map((r) => (r.at === report.at ? { ...r, serverId: reportId } : r))))
          .catch(fail);
      }
      return report;
    },
    undoLineReport: (report) => {
      setLineReports((list) => list.filter((r) => r.at !== report.at));
      const serverId = lineReports.find((r) => r.at === report.at)?.serverId ?? report.serverId;
      if (serverId) undoLine({ reportId: serverId as Id<'line_reports'> }).catch(fail);
    },
    xp: me?.xp ?? 0,

    vote: (dealId, v) => {
      if (needAccount()) return;
      vote({ targetType: 'deal', targetId: dealId, value: v }).catch(fail);
    },
    confirmDeal: (dealId, kind) => {
      if (needAccount()) return;
      setConfirmedToday((s) => new Set(s).add(dealId));
      confirm({ dealId: dealId as Id<'deals'>, kind }).catch((e) => {
        setConfirmedToday((s) => {
          const next = new Set(s);
          next.delete(dealId);
          return next;
        });
        fail(e);
      });
    },
    confirmedToday,

    lists: serverLists ?? [],
    createList: (name) => {
      if (!needAccount()) createList({ name, icon: 'bookmark' }).catch(fail);
    },
    addToList: (listId, dealId) => {
      if (!needAccount()) addToList({ listId: listId as Id<'lists'>, dealId: dealId as Id<'deals'> }).catch(fail);
    },
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
