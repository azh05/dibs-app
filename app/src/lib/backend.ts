// The Convex backend (app/convex) and Clerk sign-in. Both env vars set → the app reads and writes through Convex;
// either missing → mock mode (src/lib/mock.ts), so the app still runs without a backend.
import { ConvexReactClient } from 'convex/react';

export const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL;
export const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export const usingBackend = Boolean(CONVEX_URL && CLERK_PUBLISHABLE_KEY);

export const convex = usingBackend ? new ConvexReactClient(CONVEX_URL!, { unsavedChangesWarning: false }) : null;

/** Convex errors carry the thrown message after "Uncaught Error: "; show just that. */
export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const m = raw.match(/Uncaught (?:Convex)?Error: ([^\n]+)/);
  if (m) return m[1].replace(/\s+at .*$/, '');
  if (/RateLimited/.test(raw)) return 'Slow down a little and try again shortly.';
  return raw.split('\n')[0];
}
