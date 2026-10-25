import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { clerkError, useCodeAuth } from '@/lib/clerk-auth';
import { colors, gutter } from '@/theme';

// "Already have an account? Log in": email and password.
export default function LogIn() {
  const insets = useSafeAreaInsets();
  const { ready, logIn } = useCodeAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await logIn(email.trim(), password);
      router.dismissAll();
      router.replace('/deals');
    } catch (e) {
      setError(clerkError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: insets.top + 24 }]}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <Text weight="extrabold" size={28} tracking={-0.84}>
          Welcome back
        </Text>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@school.edu"
          keyboardType="email-address"
          autoCapitalize="none"
          textContentType="emailAddress"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          secureTextEntry
          autoCapitalize="none"
          textContentType="password"
          hint={error && <Text weight="semibold" size={12} color={colors.orange}>{error}</Text>}
        />
      </View>
      <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Button label={busy ? 'Logging in…' : 'Log in'} onPress={submit} disabled={!ready || !email || !password || busy} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { gap: 14, paddingHorizontal: gutter + 4 },
  cta: { marginTop: 'auto', paddingHorizontal: gutter + 4 },
});
