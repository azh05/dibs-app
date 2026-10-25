// Mock mode, or Clerk + Convex when EXPO_PUBLIC_CONVEX_URL and EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY are set.
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import type { ReactNode } from 'react';

import { BackendStoreProvider } from '@/lib/backend-store';
import { CLERK_PUBLISHABLE_KEY, convex, usingBackend } from '@/lib/backend';
import { MockStoreProvider } from '@/lib/store';

export function AppProviders({ children }: { children: ReactNode }) {
  if (!usingBackend || !convex) return <MockStoreProvider>{children}</MockStoreProvider>;
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY!} tokenCache={tokenCache}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <BackendStoreProvider>{children}</BackendStoreProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
