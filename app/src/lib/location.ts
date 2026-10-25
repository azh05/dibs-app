// The user's current place, named the way scans key areas (neighbourhood, city, region).
import * as Location from 'expo-location';

import type { NewPlace } from '@/lib/store';

/** The areas we scan for deals (the demo's launch areas), to pick from without location access. */
export const NEIGHBORHOODS: (NewPlace & { label: string })[] = [
  {
    label: 'Westwood, LA',
    neighborhood: 'Westwood',
    city: 'Los Angeles',
    region: 'California',
    coords: { latitude: 34.0628, longitude: -118.4455 },
  },
  {
    label: 'Palace of Fine Arts, SF',
    neighborhood: 'Marina District',
    city: 'San Francisco',
    region: 'California',
    coords: { latitude: 37.8029, longitude: -122.4484 },
  },
  {
    label: 'Santa Monica',
    neighborhood: 'Santa Monica',
    city: 'Santa Monica',
    region: 'California',
    coords: { latitude: 34.0195, longitude: -118.4912 },
  },
  {
    label: 'Berkeley',
    neighborhood: 'Downtown Berkeley',
    city: 'Berkeley',
    region: 'California',
    coords: { latitude: 37.8716, longitude: -122.2727 },
  },
];

/** Where the device is, or null without permission or a fix. */
export async function currentPlace(): Promise<NewPlace | null> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) return null;
  const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const point = { latitude: coords.latitude, longitude: coords.longitude };
  const [address] = await Location.reverseGeocodeAsync(point).catch(() => []);
  const neighborhood = address?.district ?? address?.subregion ?? address?.city ?? undefined;
  const city = address?.city ?? undefined;
  return {
    label: neighborhood && city && neighborhood !== city ? `${neighborhood}, ${city}` : (city ?? 'Current location'),
    coords: point,
    neighborhood: neighborhood ?? undefined,
    city,
    region: address?.region ?? undefined,
  };
}
