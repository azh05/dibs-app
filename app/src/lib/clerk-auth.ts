// Sign-in with Clerk (backend mode): Apple and Google through Clerk's hosted OAuth (works in Expo Go), phone with an
// SMS code, email + password with an emailed code. Uses Clerk's classic sign-in/sign-up resources.
import { isClerkAPIResponseError, useSSO } from '@clerk/expo';
import { useSignIn, useSignUp } from '@clerk/expo/legacy';
import * as AuthSession from 'expo-auth-session';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

export type CodeMode = 'phone-in' | 'phone-up' | 'email-up';

/** Fields the finish step can collect when Clerk's settings require more than the user gave. */
export const FINISH_FIELDS = ['email_address', 'username', 'password', 'first_name', 'last_name'] as const;
export type FinishField = (typeof FINISH_FIELDS)[number];

/** Where a sign-up stands: done (signed in), needs a code for a newly added email or phone, or needs fields. */
export type SignUpOutcome =
  | { done: true; isNew: boolean }
  | { done: false; verify: CodeMode; to: string }
  | { done: false; missing: FinishField[] };

export function clerkError(e: unknown): string {
  if (isClerkAPIResponseError(e)) return e.errors[0]?.longMessage ?? e.errors[0]?.message ?? 'Sign-in failed';
  return e instanceof Error ? e.message : String(e);
}

/** Apple or Google. Returns whether this created a new account, or null if the user backed out. */
export function useSocialSignIn() {
  const { startSSOFlow } = useSSO();
  return async (strategy: 'oauth_google' | 'oauth_apple') => {
    const { createdSessionId, setActive, signUp } = await startSSOFlow({ strategy, redirectUrl: AuthSession.makeRedirectUri() });
    if (!createdSessionId || !setActive) return null;
    await setActive({ session: createdSessionId });
    return { isNew: Boolean(signUp?.createdSessionId) };
  };
}

export function useCodeAuth() {
  const signInState = useSignIn();
  const signUpState = useSignUp();
  const ready = signInState.isLoaded && signUpState.isLoaded;

  /** Text a code to this number: sign in if it has an account, otherwise start a new one. */
  const sendPhoneCode = async (phoneNumber: string): Promise<CodeMode> => {
    if (!signInState.isLoaded || !signUpState.isLoaded) throw new Error('Still loading, try again');
    try {
      const attempt = await signInState.signIn.create({ identifier: phoneNumber });
      const factor = attempt.supportedFirstFactors?.find((f) => f.strategy === 'phone_code') as
        | { strategy: 'phone_code'; phoneNumberId: string }
        | undefined;
      if (!factor) throw new Error('Phone sign-in isn’t turned on for this app');
      await signInState.signIn.prepareFirstFactor({ strategy: 'phone_code', phoneNumberId: factor.phoneNumberId });
      return 'phone-in';
    } catch (e) {
      if (!isClerkAPIResponseError(e) || e.errors[0]?.code !== 'form_identifier_not_found') throw e;
      await signUpState.signUp.create({ phoneNumber });
      await signUpState.signUp.preparePhoneNumberVerification({ strategy: 'phone_code' });
      return 'phone-up';
    }
  };

  /** Create account with email and password; Clerk emails a code to confirm the address. */
  const startEmailSignUp = async (emailAddress: string, password: string) => {
    if (!signUpState.isLoaded) throw new Error('Still loading, try again');
    await signUpState.signUp.create({ emailAddress, password });
    await signUpState.signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
  };

  /** After any sign-up step: sign in if complete, else say what Clerk still needs. */
  const next = async (attempt: Awaited<ReturnType<NonNullable<typeof signUpState.signUp>['update']>>): Promise<SignUpOutcome> => {
    if (!signUpState.isLoaded) throw new Error('Still loading, try again');
    if (attempt.status === 'complete') {
      await signUpState.setActive({ session: attempt.createdSessionId });
      return { done: true, isNew: true };
    }
    // A newly added email or phone has to be confirmed with its own code.
    if (attempt.unverifiedFields.includes('email_address') && attempt.emailAddress) {
      await attempt.prepareEmailAddressVerification({ strategy: 'email_code' });
      return { done: false, verify: 'email-up', to: attempt.emailAddress };
    }
    if (attempt.unverifiedFields.includes('phone_number') && attempt.phoneNumber) {
      await attempt.preparePhoneNumberVerification({ strategy: 'phone_code' });
      return { done: false, verify: 'phone-up', to: attempt.phoneNumber };
    }
    const missing = attempt.missingFields.filter((f): f is FinishField => (FINISH_FIELDS as readonly string[]).includes(f));
    if (!missing.length) throw new Error(`Clerk needs: ${attempt.missingFields.join(', ') || attempt.status}`);
    return { done: false, missing };
  };

  /** Check the code. Signs in when that finishes the sign-in or sign-up. */
  const verify = async (mode: CodeMode, code: string): Promise<SignUpOutcome> => {
    if (!signInState.isLoaded || !signUpState.isLoaded) throw new Error('Still loading, try again');
    if (mode === 'phone-in') {
      const done = await signInState.signIn.attemptFirstFactor({ strategy: 'phone_code', code });
      if (done.status !== 'complete') throw new Error('One more step is needed to sign in');
      await signInState.setActive({ session: done.createdSessionId });
      return { done: true, isNew: false };
    }
    const attempt =
      mode === 'phone-up'
        ? await signUpState.signUp.attemptPhoneNumberVerification({ code })
        : await signUpState.signUp.attemptEmailAddressVerification({ code });
    return next(attempt);
  };

  /** Fill in what Clerk's settings require (email, username, password, name), then carry on. */
  const finish = async (fields: Partial<Record<FinishField, string>>): Promise<SignUpOutcome> => {
    if (!signUpState.isLoaded) throw new Error('Still loading, try again');
    const attempt = await signUpState.signUp.update({
      emailAddress: fields.email_address,
      username: fields.username,
      password: fields.password,
      firstName: fields.first_name,
      lastName: fields.last_name,
    });
    return next(attempt);
  };

  const logIn = async (identifier: string, password: string) => {
    if (!signInState.isLoaded) throw new Error('Still loading, try again');
    const done = await signInState.signIn.create({ identifier, password });
    if (done.status !== 'complete') throw new Error('One more step is needed to sign in');
    await signInState.setActive({ session: done.createdSessionId });
  };

  return { ready, sendPhoneCode, startEmailSignUp, verify, finish, logIn };
}

/** Go wherever a sign-up step leaves the user. */
export function goAfter(outcome: SignUpOutcome) {
  if (outcome.done) {
    if (outcome.isNew) router.replace('/onboarding/interests');
    else {
      router.dismissAll();
      router.replace('/deals');
    }
  } else if ('verify' in outcome) {
    router.replace({ pathname: '/onboarding/verify', params: { mode: outcome.verify, to: outcome.to } });
  } else {
    router.replace({ pathname: '/onboarding/finish', params: { fields: outcome.missing.join(',') } });
  }
}
