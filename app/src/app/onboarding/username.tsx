import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { OnboardingProgress } from '@/components/onboarding-progress';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { toHandle, UsernameField, useUsernameAvailable } from '@/components/username-field';
import { NO_NAME } from '@/lib/account';
import { errorText } from '@/lib/backend';
import { resetTo } from '@/lib/navigation';
import { useStore } from '@/lib/store';
import { colors, gutter } from '@/theme';

// Pick a username: Apple, Google and phone sign-ups have none, and friends find people by it. Step 1 of onboarding
// for those sign-ups (?onboarding=1, then Pick interests); otherwise the tabs send any account without a username
// here, with no way back until it has one. No Figma frame: built from 04 · Create account (Figma 66:2207) and its
// Username field (66:2260).
export default function PickUsername() {
  const insets = useSafeAreaInsets();
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const inOnboarding = onboarding === '1';
  const { account, saveProfile, signOut } = useStore();
  // Untouched fields follow the account as it loads (the name from Apple or Google).
  const [typedName, setTypedName] = useState<string | null>(null);
  const [typedUsername, setTypedUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = typedName ?? (account && account.name !== NO_NAME ? account.name : '');
  const handle = toHandle(typedUsername);
  const available = useUsernameAvailable(handle);
  const valid = name.trim().length > 1 && available;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveProfile({ name: name.trim(), username: handle });
      if (inOnboarding) router.replace('/onboarding/interests');
      else resetTo('/deals');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const logOut = () => {
    signOut();
    resetTo('/');
  };

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.screen, { paddingTop: insets.top + (inOnboarding ? 0 : 24) }]}>
      <StatusBar style="dark" />
      <Stack.Screen options={{ gestureEnabled: inOnboarding }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {inOnboarding && <OnboardingProgress step={1} />}
        <Text weight="extrabold" size={28} tracking={-0.84}>
          Pick a username
        </Text>
        <Text size={14} color={colors.inkSecondary}>
          Friends find you by your @username or your name.
        </Text>
        <TextField
          label="Name"
          value={name}
          onChangeText={setTypedName}
          placeholder="Your name"
          textContentType="name"
        />
        <UsernameField handle={handle} available={available} onChangeText={setTypedUsername} autoFocus />
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        {error && (
          <Text weight="semibold" size={12} color={colors.orange}>
            {error}
          </Text>
        )}
        <Button
          label={busy ? 'Saving…' : 'Continue'}
          onPress={save}
          style={styles.ctaButton}
          disabled={!valid || busy || !account}
        />
        {!inOnboarding && (
          <Pressable onPress={logOut} hitSlop={8} accessibilityRole="button">
            <Text weight="bold" size={13} color={colors.inkSecondary}>
              Log out
            </Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { gap: 14, paddingTop: 6, paddingHorizontal: gutter + 4, paddingBottom: 24 },
  cta: {
    gap: 10,
    paddingTop: 10,
    paddingHorizontal: gutter + 4,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  ctaButton: { alignSelf: 'stretch', paddingVertical: 17 },
});
