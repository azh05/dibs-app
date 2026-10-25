// Line check (Figma "11 · Line check" and its note): when location shows you inside a store's
// geofence for ~2 min while dibs is open, ask once per visit how long the line is. Reports from
// the last hour are combined, recent ones counting more.
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

import type { Deal, LatLng, LineEstimate } from '@/lib/types';

export const LINE_OPTIONS = [
  { minutes: 5, label: '<10' },
  { minutes: 15, label: '15' },
  { minutes: 30, label: '30' },
  { minutes: 45, label: '45' },
  { minutes: 60, label: '60+' },
];

/** Fallback when a store has no geofence of its own (the backend's stores.geofence_m, default 75). */
export const GEOFENCE_METERS = 75;
export const DWELL_MS = 2 * 60_000;
export const AUTO_DISMISS_MS = 10_000;
export const REPORT_XP = 10;
const REPORT_WINDOW_MS = 60 * 60_000;

/** serverId: the backend's line_reports id, for undo. */
export type LineReport = { dealId: string; minutes: number; at: number; serverId?: string };

export function distanceMeters(a: LatLng, b: LatLng) {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** The deal's seeded estimate blended with this user's recent reports (newer weigh more). */
export function combinedLine(deal: Deal, reports: LineReport[], now = Date.now()): LineEstimate | null {
  // A report the server has saved (serverId) is already in deal.line, the shared estimate; counting it again here
  // would show the reporter one report too many.
  const recent = reports.filter((r) => r.dealId === deal.id && !r.serverId && now - r.at < REPORT_WINDOW_MS);
  if (recent.length === 0) return deal.line;
  const seeded = deal.line ? [{ minutes: deal.line.minutes, weight: deal.line.reports * 0.5 }] : [];
  const mine = recent.map((r) => ({ minutes: r.minutes, weight: 1 - (now - r.at) / REPORT_WINDOW_MS }));
  const all = [...seeded, ...mine];
  const total = all.reduce((sum, r) => sum + r.weight, 0);
  const minutes = all.reduce((sum, r) => sum + r.minutes * r.weight, 0) / total;
  return { minutes, reports: (deal.line?.reports ?? 0) + recent.length };
}

/** "<10 min", "~15 min", "60+ min" */
export function lineLabel(minutes: number) {
  if (minutes < 10) return '<10 min';
  if (minutes >= 60) return '60+ min';
  return `~${Math.round(minutes / 5) * 5} min`;
}

/** The device's position while the screen is open, or null without permission. */
export function useUserLocation() {
  const [position, setPosition] = useState<LatLng | null>(null);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    let active = true;
    (async () => {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted || !active) return;
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10 },
        ({ coords }) => setPosition({ latitude: coords.latitude, longitude: coords.longitude }),
      );
      if (!active) subscription.remove();
    })().catch(() => undefined);
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);

  return position;
}

/** The store to ask about, once the user has stayed inside its geofence for the dwell time. */
export function useLineCheck(deals: Deal[], position: LatLng | null) {
  const [store, setStore] = useState<Deal | null>(null);
  const visit = useRef<{ dealId: string; since: number; asked: boolean } | null>(null);

  const inside = position
    ? deals.find((d) => d.coords && distanceMeters(position, d.coords) <= (d.geofenceM ?? GEOFENCE_METERS))
    : undefined;
  const insideId = inside?.id ?? null;

  useEffect(() => {
    if (!insideId) {
      visit.current = null;
      return;
    }
    if (visit.current?.dealId !== insideId) visit.current = { dealId: insideId, since: Date.now(), asked: false };
    const current = visit.current;
    if (current.asked) return;
    const id = setTimeout(
      () => {
        current.asked = true;
        setStore(deals.find((d) => d.id === insideId) ?? null);
      },
      Math.max(0, current.since + DWELL_MS - Date.now()),
    );
    return () => clearTimeout(id);
  }, [insideId, deals]);

  return { store, dismiss: () => setStore(null) };
}
