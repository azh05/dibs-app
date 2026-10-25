import { GeospatialIndex } from "@convex-dev/geospatial";

import { components } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

export const METERS_PER_MILE = 1609.344;

/** Active deals that have coordinates (their store's). Filter on store type and deal types. */
export const dealGeo = new GeospatialIndex<Id<"deals">, { store_type: string; deal_types: string[] }>(
  components.dealGeo,
);

/** Saved locations with alerts on, for finding who to notify about a new deal. */
export const locationGeo = new GeospatialIndex<Id<"saved_locations">, Record<string, never>>(components.locationGeo);

/** Scan area centers, for finding the area a new saved location falls in. */
export const areaGeo = new GeospatialIndex<Id<"scan_areas">, Record<string, never>>(components.areaGeo);

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
