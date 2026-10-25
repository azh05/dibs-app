import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { alreadySignedIn, clerkError, goAfter, useCodeAuth, type CodeMode } from '@/lib/clerk-auth';
import { colors, gutter } from '@/theme';

// The 6-digit code from a text (phone) or email (Create account). New accounts go on to Pick interests.
export default function VerifyCode() {
  const insets = useSafeAreaInsets();
  const { mode, to } = useLocalSearchParams<{ mode: CodeMode; to: string }>();
  const { ready, verify } = useCodeAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      goAfter(await verify(mode, code.trim()));
    } catch (e) {
      if (alreadySignedIn(e)) {
        router.dismissAll();
        router.replace('/deals');
        return;
      }
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
          Enter the code
        </Text>
        <Text size={14} color={colors.inkSecondary}>
          We sent a 6-digit code to {to}.
        </Text>
        <TextField
          label="Code"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          autoFocus
          hint={error && <Text weight="semibold" size={12} color={colors.orange}>{error}</Text>}
        />
      </View>
      <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Button label={busy ? 'Checking…' : 'Continue'} onPress={submit} disabled={!ready || code.length !== 6 || busy} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { gap: 14, paddingHorizontal: gutter + 4 },
  cta: { marginTop: 'auto', paddingHorizontal: gutter + 4 },
});
