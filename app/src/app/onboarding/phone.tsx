import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { alreadySignedIn, clerkError, useCodeAuth } from '@/lib/clerk-auth';
import { colors, gutter } from '@/theme';

/** "(310) 555-0100" → "+13105550100"; numbers already in +country form pass through. */
function e164(input: string) {
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

// Continue with phone: we text a code, then the code screen signs in (or creates the account).
export default function PhoneSignIn() {
  const insets = useSafeAreaInsets();
  const { ready, sendPhoneCode } = useCodeAuth();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = phone.replace(/\D/g, '').length >= 10;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const mode = await sendPhoneCode(e164(phone));
      router.push({ pathname: '/onboarding/verify', params: { mode, to: phone } });
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
          What’s your number?
        </Text>
        <Text size={14} color={colors.inkSecondary}>
          We’ll text you a 6-digit code. New here? This creates your account.
        </Text>
        <TextField
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          placeholder="(310) 555-0100"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoFocus
          hint={error && <Text weight="semibold" size={12} color={colors.orange}>{error}</Text>}
        />
      </View>
      <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Button label={busy ? 'Sending…' : 'Send code'} onPress={send} disabled={!ready || !valid || busy} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { gap: 14, paddingHorizontal: gutter + 4 },
  cta: { marginTop: 'auto', paddingHorizontal: gutter + 4 },
});
