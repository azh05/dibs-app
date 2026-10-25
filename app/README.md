# dibs app

Expo (SDK 58, expo-router) app built from the Figma file ["dibs — App Design"](https://www.figma.com/design/6mfeMN9XPnjwR6dn2DwdsG): all 22 screens in its six sections (Onboarding, Discover, Alerts & Saved, Earn credits, Friends & profile, Notifications), wired the way its prototype links are.

```bash
npm install
npx expo start --ios        # Expo Go on the iOS simulator
npx tsc --noEmit && npx expo lint
npm test                    # Convex backend tests (convex/*.test.ts)
```

Two modes, picked by env vars in `.env.local`:

- **Backend**: `EXPO_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` both set. Sign-in is Clerk; everything is read and written through Convex (`convex/`), so it persists and syncs. The feed is the deals Convex's 24/7 scans stored near your saved place. Photos upload to Convex, which has the API read them. The app never calls the Dibs API itself. Setup: [convex/README.md](convex/README.md#setup-start-to-finish).
- **Mock**: either variable missing. Data comes from `src/lib/mock.ts` and `src/lib/social.ts`, sign-in is a demo account, and everything resets on restart. The photo check returns the Figma example, an expired Chipotle poster.

Expo reads `.env.local` when Metro starts, so restart with `npx expo start --clear` after editing it.

`useStore()` (`src/lib/store.tsx`) has the same interface in both: `MockStoreProvider` in memory, `BackendStoreProvider` (`src/lib/backend-store.tsx`) on Convex with optimistic toggles. `src/lib/feed.ts` maps Convex deal views onto the screens' `Deal` and `DealEvent`; `src/lib/social-data.ts` serves Profile, Friends and Leaderboard in the shapes of the mocks.

## Flow

Welcome → Sign in → (email: Create account) → Pick interests → Live alerts → Deals.

- With the backend: Apple and Google go through Clerk; phone sends a text code that signs in or creates the account; email goes through Create account (name, username, password, birthday, invite code) and an emailed code; Log in is email and password. If the Clerk app requires more than the user gave, an "Almost there" step asks for it. In mock mode every button signs in as the demo account.
- "Turn on live alerts" saves your current location (or Westwood) as the place alerts and scans use; change it any time from the Deals header (`location` modal).
- `dibs://invite/<code>` fills in a friend's invite code on Create account.
- The tab bar has Deals, Map, Friends, Earn, Alerts and Profile. Saved and Leaderboard open from Profile (and Leaderboard from Friends) and keep the tab bar, with Profile lit.
- Deals and Map open Filters, a modal that edits a draft. Deal and event cards open their detail pages.

## Screens

- **Welcome**: store types cycle through a wheel (each holds 0.5 s, then slides up). Without location, the pill says "Turn on location to see spots near you", and "Find deals near me" shows the iOS location prompt before Sign in; with it, the pill shows the spots being watched.
- **Pick interests**: 72 store types in sections, plus 8 deal types and an alert distance. Nightlife and 21+ shops unlock once the birthday on the account shows 21+, and then carry a 21+ note. Accounts without a birthday (phone and social sign-ups) are asked for it the first time they tap Verify 21+.
- **Deals**: "Agents searching 24/7" with its sources, then chips: "All" (on at first), your store-type interests, every deal type and "+ Edit". Several chips can be on at once. Below them: upcoming events and the live feed.
- **Map**: Beli-style list/map toggle. A search bar and a row of filter chips (Open now, Verified, deal types; the slider chip opens Filters) sit above either the map, with recency pins that fold together when they'd overlap and a card for the tapped pin, or a list of the same deals. **View List** / **View Map** swaps them.
- **Friends**: rank cards for Westwood and your school (each opens the leaderboard), friends ranked by money saved with a Westwood/school switch, and an activity feed with likes. Save or "I'm in" on a card adds its deal or event to Saved. The search button opens `find-friends` (search by @username, answer requests; backend only).
- **Earn**: snap an in-store deal and earn 500 credits once it's verified (`CREDITS_PER_DEAL` in `src/lib/photo.ts`). With the backend, only a new, live deal earns them; they're pending until 24 hours pass with no "ended" report or 2 other people confirm it, at most 3 a day. Rewards are always credits, never money.
- **Alerts**: the Instant toggle, your interests (tap an unpicked store type to add it), the alert distance, and recent alerts.
- **Profile**: level and XP, money saved with a weekly bar chart, rank cards, deal DNA, lists, a row of friends and invites (both people get 500 credits; the share includes your invite link).
- **Deal page**: directions, follow, "Still running? Yes / Ended", thumbs up or down, and Add to a list. Three "ended" reports hide a deal. "Used it" on Saved asks what you saved, which feeds $ saved, Deal DNA and the leaderboards.

## What runs for real

- **Deal alerts**: with the backend, Convex pushes new matching deals near your saved place and scheduled reminders through Expo (`src/lib/push.ts` registers the token after sign-in; needs an EAS `projectId` from `npx eas-cli@latest init`, and a development build on Android). Locally: notifications (`src/lib/notifications.ts`) with Get Directions / Save / Remind Me actions; the body is the deal, then when it ends ("Ends Oct 24, 6 PM"). "Turn on live alerts" asks for permission and sends one for your best-matching deal; tapping an alert opens the deal. Store logos as the notification icon need iOS communication notifications, which Expo can't send. The poster image in the expanded notification needs an image URL the API doesn't return yet.
- **Line check**: with location allowed, staying inside a store's geofence (75 m by default) for 2 minutes while the Map is open asks how long the line is, once per visit (`src/lib/line-check.ts`). With the backend, reports go to Convex; only reports inside the geofence count, and they earn 10 XP up to 5 times a day. The blended estimate shows on deal cards and the deal page. On the simulator, `xcrun simctl location booted set 34.0644,-118.4419` puts you at Tapioca Lab.
- **Search and Ask dibs** (needs `EXPO_PUBLIC_API_URL` and the API's Elastic setup; works alongside backend mode):
  - Typing in Deals search queries `/search/deals`, which searches every indexed deal by meaning (any language) and distance.
  - The sparkles button next to the bell opens Ask dibs (`src/app/ask.tsx`, not in Figma yet), a chat with the Elastic agent that shows the deals it found as cards. It can also watch for new deals; that needs a push token, so a development build with an EAS project id.
  - Set `EXPO_PUBLIC_DIBS_API_KEY` when the API has `DIBS_API_KEY`. That key ships inside the app bundle, so it's for development; in production these calls should go through Convex.
- **Filters**: sort (best deals, relevance, distance), distance, store types, deal types, open now (on by default), community verified and hide likely expired. They apply across Deals and Map.

In mock mode nothing persists: the account, saves, likes, interests, line reports, credits and XP reset on restart, and friends, ranks and leaderboards are mock data. In backend mode they all live in Convex.

## Layout

```
src/app/            routes: index (Welcome), onboarding/sign-in|phone|verify|finish|log-in|create-account|interests|alerts, ask (modal),
                    (tabs)/deals|map|friends|earn|alerts|profile, plus (tabs)/saved|leaderboard (hidden tabs),
                    filters and location (modals), deal/[id], event/[id], submission, find-friends, invite/[code]
src/components/     one component per Figma component (DealCard, StoreLogo, CategoryWheel, TabBar, LineCheckCard, ...)
src/lib/            types (mirrors api/app/schemas.py), interest catalog, filters, account, line check, notifications,
                    store (mock) and backend-store (Convex), feed mapping, deals hooks (api.ts), social-data,
                    Clerk sign-in, push, location, age gate, mock and social data, formatting
convex/             the Convex backend (see convex/README.md)
src/theme.ts        Figma colour variables, fonts (Plus Jakarta Sans), radii
assets/icons/       Figma icon set; #16161A is mapped to currentColor (.svgrrc) so icons take a `color`
assets/shapes/      pin tails, dots, location halo, logo dot, lock-screen glows
```
