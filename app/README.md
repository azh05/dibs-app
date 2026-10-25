# dibs app

Expo (SDK 58, expo-router) app built from the Figma file "dibs — App Design": all 22 screens in its six sections (Onboarding, Discover, Alerts & Saved, Earn credits, Friends & profile, Notifications), wired the way its prototype links are.

```bash
npm install
npx expo start --ios        # Expo Go on the iOS simulator
npx tsc --noEmit && npx expo lint
```

Data is mock (`src/lib/mock.ts`, `src/lib/social.ts`) unless `EXPO_PUBLIC_API_URL` points at the API, in which case the Deals list calls `POST /extract/search` (10 to 60 s, spends web searches) and maps results through `src/lib/api.ts`, and a photo snapped on Earn goes to `POST /extract/photo` (5 to 20 s, `src/lib/photo.ts`). Without the API the photo check returns the Figma example, an expired Chipotle poster.

## Flow

Welcome → Sign in → (email: Create account) → Pick interests → Live alerts → Deals. "Continue with Apple / Google / phone" and "Log in" sign in as a demo account until there is an auth backend. Profile → Leaderboard and Saved; Deals and Map → Filters (a modal that edits a draft).

## What runs for real

- **Deal alerts**: local notifications (`src/lib/notifications.ts`) with Get Directions / Save / Remind Me actions. "Turn on live alerts" asks for permission and sends one for your best-matching deal; tapping an alert opens the deal. Store logos as the notification icon need iOS communication notifications, which Expo can't send.
- **Line check**: with location allowed, staying within 60 m of a store for 2 minutes while the Map is open asks how long the line is, once per visit (`src/lib/line-check.ts`). Reports blend into the line shown on deal cards and the deal page and add 10 XP. On the simulator: `xcrun simctl location booted set 34.0644,-118.4419` puts you at Tapioca Lab.
- **Filters**: deal types, 72 store types, open now, community verified, hide likely expired, sources, distance and sort apply across Deals and Map.

Nothing is persisted yet: account, saves, interests, line reports and XP reset on restart.

## Layout

```
src/app/            routes: index (Welcome), onboarding/sign-in|create-account|interests|alerts,
                    (tabs)/deals|map|earn|alerts|profile, filters, saved, leaderboard, deal/[id], event/[id], submission
src/components/     one component per Figma component (DealCard, StoreLogo, NotificationCard, LineCheckCard, ...)
src/lib/            types (mirrors api/app/schemas.py), interest catalog, filters, account, line check, notifications,
                    mock and social data, API client, in-memory store, formatting
src/theme.ts        Figma colour variables, fonts (Plus Jakarta Sans), radii
assets/icons/       Figma icon set; #16161A is mapped to currentColor (.svgrrc) so icons take a `color`
assets/shapes/      pin tails, dots, location halo, logo dot, lock-screen glows
```
