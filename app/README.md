# dibs app

Expo (SDK 58, expo-router) app built from the Figma file "dibs — App Design".

```bash
npm install
npx expo start --ios        # Expo Go on the iOS simulator
npx tsc --noEmit && npx expo lint
```

Data is mock (`src/lib/mock.ts`) unless `EXPO_PUBLIC_API_URL` points at the API, in which case the Deals list calls `POST /extract/search` (10 to 60 s, spends web searches) and maps results through `src/lib/api.ts`, and a photo snapped on Earn $5 goes to `POST /extract/photo` (5 to 20 s, `src/lib/photo.ts`). Without the API the photo check returns the Figma example, an expired Chipotle poster.

## Layout

```
src/app/            routes: index (Welcome), onboarding/interests|alerts, (tabs)/deals|map|earn|alerts|profile, deal/[id], event/[id], submission
src/components/     one component per Figma component (DealCard, EventCard, MapPin, Chip, TabBar, ...)
src/lib/            types (mirrors api/app/schemas.py), mock data, interest catalog, API client, in-memory store, formatting
src/theme.ts        Figma colour variables, fonts (Plus Jakarta Sans), radii
assets/icons/       Figma icon set; #16161A is mapped to currentColor (.svgrrc) so icons take a `color`
assets/shapes/      pin tails, dots, location halo, logo dot, lock-screen glows
```

Nothing is persisted yet (saved deals, alerts settings, submissions reset on restart). The Profile tab is not in the design.
