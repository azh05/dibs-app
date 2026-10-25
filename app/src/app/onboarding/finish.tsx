import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { OnboardingProgress } from '@/components/onboarding-progress';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { pendingUsername } from '@/lib/backend-store';
import { clerkError, FINISH_FIELDS, goAfter, useCodeAuth, type FinishField } from '@/lib/clerk-auth';
import { colors, gutter } from '@/theme';

const FIELDS: Record<
  FinishField,
  { label: string; placeholder: string; secure?: boolean; keyboard?: 'email-address' }
> = {
  email_address: { label: 'Email', placeholder: 'you@school.edu', keyboard: 'email-address' },
  username: { label: 'Username', placeholder: 'username' },
  password: { label: 'Password', placeholder: 'Choose a password', secure: true }, // Clerk's settings decide the minimum length
  first_name: { label: 'First name', placeholder: 'Maya' },
  last_name: { label: 'Last name', placeholder: 'Rodriguez' },
};

// Finish your account: what this Clerk app requires on top of what the user gave (e.g. a phone sign-up when
// email, username and password are required). A new email gets its own code next.
export default function FinishSignUp() {
  const insets = useSafeAreaInsets();
  const { fields } = useLocalSearchParams<{ fields: string }>();
  const missing = (fields ?? '')
    .split(',')
    .filter((f): f is FinishField => (FINISH_FIELDS as readonly string[]).includes(f));
  const { ready, finish } = useCodeAuth();
  const [values, setValues] = useState<Partial<Record<FinishField, string>>>(() => ({ username: pendingUsername() }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = missing.every((f) => (values[f] ?? '').trim().length > 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const clean = Object.fromEntries(missing.map((f) => [f, f === 'password' ? values[f] : values[f]?.trim()]));
      goAfter(await finish(clean));
    } catch (e) {
      setError(clerkError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <OnboardingProgress />
        <Text weight="extrabold" size={28} tracking={-0.84}>
          Almost there
        </Text>
        <Text size={14} color={colors.inkSecondary}>
          A few more details to finish your account.
        </Text>
        {missing.map((f, i) => (
          <TextField
            key={f}
            label={FIELDS[f].label}
            value={values[f] ?? ''}
            onChangeText={(t) =>
              setValues((v) => ({ ...v, [f]: f === 'username' ? t.replace(/^@/, '').toLowerCase() : t }))
            }
            placeholder={FIELDS[f].placeholder}
            secureTextEntry={FIELDS[f].secure}
            keyboardType={FIELDS[f].keyboard}
            autoCapitalize={f === 'first_name' || f === 'last_name' ? 'words' : 'none'}
            autoFocus={i === 0}
          />
        ))}
        {error && (
          <Text weight="semibold" size={12} color={colors.orange}>
            {error}
          </Text>
        )}
      </ScrollView>
      <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Button label={busy ? 'Saving…' : 'Continue'} onPress={submit} disabled={!ready || !filled || busy} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { gap: 14, paddingTop: 6, paddingHorizontal: gutter + 4, paddingBottom: 24 },
  cta: { paddingHorizontal: gutter + 4 },
});
