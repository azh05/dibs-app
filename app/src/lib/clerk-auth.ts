// Sign-in with Clerk (backend mode): Apple and Google through Clerk's hosted OAuth (works in Expo Go), phone with an
// SMS code, email + password with an emailed code. Uses Clerk's classic sign-in/sign-up resources.
import { isClerkAPIResponseError, useSSO } from '@clerk/expo';
import { useSignIn, useSignUp } from '@clerk/expo/legacy';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

export type CodeMode = 'phone-in' | 'phone-up' | 'email-up';

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

  /** Check the code and start the session. Returns true for a brand-new account. */
  const verify = async (mode: CodeMode, code: string): Promise<boolean> => {
    if (!signInState.isLoaded || !signUpState.isLoaded) throw new Error('Still loading, try again');
    if (mode === 'phone-in') {
      const done = await signInState.signIn.attemptFirstFactor({ strategy: 'phone_code', code });
      if (done.status !== 'complete') throw new Error('One more step is needed to sign in');
      await signInState.setActive({ session: done.createdSessionId });
      return false;
    }
    const done =
      mode === 'phone-up'
        ? await signUpState.signUp.attemptPhoneNumberVerification({ code })
        : await signUpState.signUp.attemptEmailAddressVerification({ code });
    if (done.status !== 'complete') throw new Error(`Clerk needs more details: ${done.missingFields.join(', ') || done.status}`);
    await signUpState.setActive({ session: done.createdSessionId });
    return true;
  };

  const logIn = async (identifier: string, password: string) => {
    if (!signInState.isLoaded) throw new Error('Still loading, try again');
    const done = await signInState.signIn.create({ identifier, password });
    if (done.status !== 'complete') throw new Error('One more step is needed to sign in');
    await signInState.setActive({ session: done.createdSessionId });
  };

  return { ready, sendPhoneCode, startEmailSignUp, verify, logIn };
}
