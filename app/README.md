# dibs app

Expo (SDK 58, expo-router) app built from the Figma file ["dibs — App Design"](https://www.figma.com/design/6mfeMN9XPnjwR6dn2DwdsG): all 22 screens in its six sections (Onboarding, Discover, Alerts & Saved, Earn credits, Friends & profile, Notifications), wired the way its prototype links are.

```bash
npm install
npx expo start --ios        # Expo Go on the iOS simulator
npx tsc --noEmit && npx expo lint
```

Data is mock (`src/lib/mock.ts`, `src/lib/social.ts`) unless `EXPO_PUBLIC_API_URL` points at the API. When it does, the Deals list calls `POST /extract/search` (10 to 60 s, spends web searches) and maps results through `src/lib/api.ts`, and a photo snapped on Earn goes to `POST /extract/photo` (5 to 20 s, `src/lib/photo.ts`). Without the API, the photo check returns the Figma example: an expired Chipotle poster.

## Flow

Welcome → Sign in → (email: Create account) → Pick interests → Live alerts → Deals.

- "Continue with Apple / Google / phone" and "Log in" sign in as a demo account until there is an auth backend.
- The tab bar has Deals, Map, Friends, Earn, Alerts and Profile. Saved and Leaderboard open from Profile (and Leaderboard from Friends) and keep the tab bar, with Profile lit.
- Deals and Map open Filters, a modal that edits a draft. Deal and event cards open their detail pages.

## Screens

- **Welcome**: store types cycle through a wheel (each holds 0.5 s, then slides up). Without location, the pill says "Turn on location to see spots near you", and "Find deals near me" shows the iOS location prompt before Sign in; with it, the pill shows the spots being watched.
- **Pick interests**: 72 store types in sections, plus 8 deal types and an alert distance. Nightlife and 21+ shops unlock once the birthday on the account shows 21+, and then carry a 21+ note.
- **Deals**: "Agents searching 24/7" with its sources, then chips: "All" (on at first), your store-type interests, every deal type and "+ Edit". Several chips can be on at once. Below them: upcoming events and the live feed.
- **Map**: recency pins that fold together when they'd overlap. A bottom sheet shows the selected or top deal; **Edit** opens Filters.
- **Friends**: rank cards for Westwood and your school (each opens the leaderboard), friends ranked by money saved with a Westwood/school switch, and an activity feed. Save or "I'm in" on a card adds its deal or event to Saved.
- **Earn**: snap an in-store deal and earn 500 credits once it's verified (`CREDITS_PER_DEAL` in `src/lib/photo.ts`). Rewards are always credits, never money.
- **Alerts**: the Instant toggle, your interests (tap an unpicked store type to add it), the alert distance, and recent alerts.
- **Profile**: level and XP, money saved with a weekly bar chart, rank cards, deal DNA, lists, a row of friends and invites (both people get 500 credits).

## What runs for real

- **Deal alerts**: local notifications (`src/lib/notifications.ts`) with Get Directions / Save / Remind Me actions; the body is the deal, then when it ends ("Ends Oct 24, 6 PM"). "Turn on live alerts" asks for permission and sends one for your best-matching deal; tapping an alert opens the deal. Store logos as the notification icon need iOS communication notifications, which Expo can't send. The poster image in the expanded notification needs an image URL the API doesn't return yet.
- **Line check**: with location allowed, staying within 60 m of a store for 2 minutes while the Map is open asks how long the line is, once per visit (`src/lib/line-check.ts`). Reports blend into the line shown on deal cards and the deal page and add 10 XP. On the simulator, `xcrun simctl location booted set 34.0644,-118.4419` puts you at Tapioca Lab.
- **Filters**: sort (best deals, relevance, distance), distance, store types, deal types, open now (on by default), community verified and hide likely expired. They apply across Deals and Map.

Nothing is persisted yet: the account, saves, likes, interests, line reports, credits and XP reset on restart. Friends, ranks and leaderboards are mock data.

## Layout

```
src/app/            routes: index (Welcome), onboarding/sign-in|create-account|interests|alerts,
                    (tabs)/deals|map|friends|earn|alerts|profile, plus (tabs)/saved|leaderboard (hidden tabs),
                    filters (modal), deal/[id], event/[id], submission
src/components/     one component per Figma component (DealCard, StoreLogo, CategoryWheel, TabBar, LineCheckCard, ...)
src/lib/            types (mirrors api/app/schemas.py), interest catalog, filters, account, line check, notifications,
                    mock and social data, API client, in-memory store, formatting
src/theme.ts        Figma colour variables, fonts (Plus Jakarta Sans), radii
assets/icons/       Figma icon set; #16161A is mapped to currentColor (.svgrrc) so icons take a `color`
assets/shapes/      pin tails, dots, location halo, logo dot, lock-screen glows
```
