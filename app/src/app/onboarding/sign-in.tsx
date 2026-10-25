import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import type { IconName } from '@/components/icon';
import { StudentVerify } from '@/components/student-verify';
import { Text } from '@/components/text';
import { Wordmark } from '@/components/wordmark';
import { DEMO_ACCOUNT } from '@/lib/account';
import { useStore } from '@/lib/store';
import { colors } from '@/theme';

const PROVIDERS: { label: string; icon?: IconName; variant: 'dark' | 'outline' }[] = [
  { label: 'Continue with Apple', variant: 'dark' },
  { label: 'Continue with Google', variant: 'outline' },
  { label: 'Continue with phone', icon: 'phone', variant: 'outline' },
];

// 02 · Sign in (Figma 49:1450). Apple, Google and phone sign in as the demo account until there
// is an auth backend; email goes through Create account.
export default function SignIn() {
  const insets = useSafeAreaInsets();
  const { signIn, studentDomain, setStudentDomain } = useStore();

  const continueWithProvider = () => {
    signIn({ ...DEMO_ACCOUNT, studentDomain: studentDomain ?? DEMO_ACCOUNT.studentDomain });
    router.push('/onboarding/interests');
  };

  const logIn = () => {
    signIn(DEMO_ACCOUNT);
    router.dismissAll();
    router.replace('/deals');
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.hero, { paddingTop: insets.top + 14 }]}>
        <Wordmark height={113.4} color={colors.surface} dot="ink" />
        <Text weight="extrabold" size={36} tracking={-1.08} color={colors.surface} style={{ lineHeight: 40 }}>
          Never miss out on a deal again.
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {PROVIDERS.map((p) => (
          <Button key={p.label} label={p.label} icon={p.icon} variant={p.variant} onPress={continueWithProvider} />
        ))}
        <Button
          label="Continue with email"
          icon="mail"
          variant="outline"
          onPress={() => router.push('/onboarding/create-account')}
        />

        <View style={styles.divider}>
          <View style={styles.rule} />
          <Text weight="bold" size={12} color={colors.inkTertiary}>
            students
          </Text>
          <View style={styles.rule} />
        </View>

        <StudentVerify domain={studentDomain} onVerified={setStudentDomain} />

        <View style={styles.logIn}>
          <Text size={14} color={colors.inkSecondary}>
            Already have an account?
          </Text>
          <Pressable onPress={logIn} hitSlop={8} accessibilityRole="button">
            <Text weight="bold" size={14} color={colors.orange}>
              Log in
            </Text>
          </Pressable>
        </View>
        <Text size={11} color={colors.inkTertiary} style={{ textAlign: 'center' }}>
          By continuing you agree to our Terms and Privacy Policy.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  hero: { gap: 14, paddingHorizontal: 28, paddingBottom: 32, backgroundColor: colors.orange },
  content: { gap: 12, paddingTop: 24, paddingHorizontal: 24, paddingBottom: 40 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rule: { flex: 1, height: 1, backgroundColor: colors.border },
  logIn: { flexDirection: 'row', justifyContent: 'center', gap: 4, paddingTop: 6 },
});
