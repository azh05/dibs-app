# dibs app

Expo (SDK 58, expo-router) app built from the Figma file "dibs — App Design": all 20 screens in its six sections (Onboarding, Discover, Alerts & Saved, Earn, Profile & social, Notifications), wired the way its prototype links are.

```bash
npm install
npx expo start --ios        # Expo Go on the iOS simulator
npx tsc --noEmit && npx expo lint
npm test                    # Convex backend tests (convex/*.test.ts)
```

Two modes, picked by env vars in `.env.local`:

- **Backend**: `EXPO_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` both set. Sign-in is Clerk; everything is read and written through Convex (`convex/`, see [convex/README.md](convex/README.md)), so it persists and syncs. The feed is the deals Convex's 24/7 scans stored near your saved place. Photos upload to Convex, which has the API read them. The app never calls the Dibs API itself.
- **Mock**: either variable missing. Data comes from `src/lib/mock.ts` and `src/lib/social.ts`, sign-in is a demo account, and everything resets on restart. The photo check returns the Figma example, an expired Chipotle poster.

`useStore()` (`src/lib/store.tsx`) has the same interface in both: `MockStoreProvider` in memory, `BackendStoreProvider` (`src/lib/backend-store.tsx`) on Convex queries and mutations with optimistic toggles. `src/lib/feed.ts` maps Convex deal views onto the screens' `Deal` and `DealEvent` types.

## Flow

Welcome → Sign in → Pick interests → Live alerts → Deals.

- **Sign in, with the backend**:
  - Apple and Google go through Clerk.
  - Phone: we text a code, and it signs in or creates the account.
  - Email: Create account (name, username, password, birthday, invite code), then an emailed code.
  - Log in: email and password.
  - If the Clerk app requires more than the user gave (e.g. email, username or password for a phone sign-up), an "Almost there" step asks for it.
  - Setup steps for Convex, the API, Clerk and push are in [convex/README.md](convex/README.md#setup-start-to-finish).
- **Sign in, mock mode**: every button signs in as the demo account.
- **"Turn on live alerts"** saves your current location (or Westwood) as the place alerts and scans use. Change it any time from the Deals header.
- **Elsewhere**:
  - Profile → Leaderboard, Saved, Find friends.
  - Deals and Map → Filters (a modal that edits a draft).
  - `dibs://invite/<code>` fills in a friend's invite code.

## What runs for real

- **Deal alerts**:
  - With the backend, Convex pushes new deals that match your interests near your saved place, with Get Directions / Save / Remind Me buttons (category `deal-alert`). The app registers its Expo push token after sign-in (`src/lib/push.ts`). This needs an EAS `projectId` (`npx eas-cli@latest init`), and a development build on Android.
  - Reminders (Remind me, saved deals ending soon) are scheduled by Convex.
  - "Turn on live alerts" also sends one local notification for your best-matching deal.
  - Store logos as the notification icon need iOS communication notifications, which Expo can't send.
- **Line check**: with location allowed, staying inside a store's geofence (75 m) for 2 minutes while the Map is open asks how long the line is, once per visit (`src/lib/line-check.ts`).
  - Reports go to Convex. Only reports inside the geofence count, and they earn 10 XP, 5 times a day.
  - The blended estimate shows on deal cards and the deal page.
  - On the simulator, `xcrun simctl location booted set 34.0644,-118.4419` puts you at Tapioca Lab.
- **Filters**: deal types, 72 store types, open now (from Google Maps hours), community verified, hide likely expired, sources, distance and sort apply across Deals and Map.
- **Earn**: a verified photo of a new, live deal earns 500 dibs credits. They're pending until 24 hours pass with no "ended" report, or 2 other people confirm the deal. Credits have no cash value.
- **Community**:
  - "Still running? Yes / Ended" and thumbs on the deal page.
  - Three "ended" reports hide a deal.
- **Saves**:
  - Saved deals and events, followed stores and lists.
  - "Used it" asks what you saved; that feeds $ saved, Deal DNA, streaks and the monthly leaderboards.
- **Social**: friends by username, a friends feed with cheers, invite links (both get 500 credits).
- **Student verification**: the `.edu` address is added to your Clerk account and confirmed with an emailed code.
- **21+**: unlocked from your birthday. Accounts without one (phone and social sign-ups) are asked for it the first time they tap Verify 21+.
- **Env changes**: Expo reads `.env.local` when Metro starts, so restart with `npx expo start --clear` after editing it.

## Layout

```
src/app/            routes: index (Welcome), onboarding/sign-in|phone|verify|finish|log-in|create-account|interests|alerts,
                    (tabs)/deals|map|earn|alerts|profile, filters, location, saved, leaderboard, friends,
                    deal/[id], event/[id], submission, invite/[code]
src/components/     one component per Figma component (DealCard, StoreLogo, NotificationCard, LineCheckCard, ...)
src/lib/            types (mirrors api/app/schemas.py), interest catalog, filters, account, line check, notifications,
                    store (mock) and backend-store (Convex), feed mapping, deals hooks (api.ts), social-data,
                    Clerk sign-in, push, location, mock and social data, formatting
convex/             the Convex backend (see convex/README.md)
src/theme.ts        Figma colour variables, fonts (Plus Jakarta Sans), radii
assets/icons/       Figma icon set; #16161A is mapped to currentColor (.svgrrc) so icons take a `color`
assets/shapes/      pin tails, dots, location halo, logo dot, lock-screen glows
```
