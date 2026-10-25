import { Redirect, useLocalSearchParams } from 'expo-router';

import { usingBackend } from '@/lib/backend';
import { setPendingProfile } from '@/lib/backend-store';

// dibs://invite/<code> from a friend's invite: remember the code for Create account, then sign in.
export default function Invite() {
  const { code } = useLocalSearchParams<{ code: string }>();
  if (usingBackend && code) setPendingProfile({ referral_code: code.toUpperCase() });
  return <Redirect href="/onboarding/sign-in" />;
}
