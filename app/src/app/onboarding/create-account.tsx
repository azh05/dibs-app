import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { OnboardingProgress } from '@/components/onboarding-progress';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import {
  eduDomain,
  formatBirthdayInput,
  isEmailValid,
  isUsernameAvailable,
  isUsernameValid,
  parseBirthday,
  passwordStrength,
} from '@/lib/account';
import { useStore } from '@/lib/store';
import { colors, gutter } from '@/theme';

const STRENGTH_COLORS = [colors.border, colors.orange, colors.orange, colors.success, colors.success];

// 03 · Create account (Figma 66:2207), onboarding step 1 of 3. Validates locally; there is no
// account backend yet.
export default function CreateAccount() {
  const insets = useSafeAreaInsets();
  const { signIn, studentDomain } = useStore();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [birthday, setBirthday] = useState('');
  const [agreed, setAgreed] = useState(false);

  const handle = username.replace(/^@/, '').toLowerCase();
  const domain = eduDomain(email);
  const strength = passwordStrength(password);
  const birthdayISO = parseBirthday(birthday);
  const birthdayInvalid = birthday.replace(/\D/g, '').length === 8 && !birthdayISO;
  const valid =
    name.trim().length > 1 &&
    isUsernameAvailable(handle) &&
    isEmailValid(email) &&
    strength.score >= 2 &&
    (birthday === '' || birthdayISO !== null) &&
    agreed;

  const create = () => {
    signIn({
      name: name.trim(),
      username: handle,
      email: email.trim(),
      birthday: birthdayISO,
      studentDomain: domain ?? studentDomain,
    });
    router.push('/onboarding/interests');
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <OnboardingProgress step={1} />
        <Text weight="extrabold" size={28} tracking={-0.84}>
          Create your account
        </Text>

        <TextField label="Name" value={name} onChangeText={setName} placeholder="Your name" textContentType="name" />
        <TextField
          label="Username"
          value={handle ? `@${handle}` : ''}
          onChangeText={setUsername}
          placeholder="@username"
          autoCapitalize="none"
          textContentType="username"
          trailing={handle.length >= 3 && <UsernameStatus handle={handle} />}
        />
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@school.edu"
          keyboardType="email-address"
          autoCapitalize="none"
          textContentType="emailAddress"
          trailing={domain && <StudentPill />}
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="8+ characters"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          textContentType="newPassword"
          style={!showPassword && password ? styles.dots : undefined}
          trailing={
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
              <Icon name="eye" size={20} color={colors.inkTertiary} />
            </Pressable>
          }
          hint={
            password !== '' && (
              <View style={styles.strength}>
                <View style={styles.bars}>
                  {[1, 2, 3, 4].map((bar) => (
                    <View
                      key={bar}
                      style={[
                        styles.bar,
                        { backgroundColor: bar <= strength.score ? STRENGTH_COLORS[strength.score] : colors.border },
                      ]}
                    />
                  ))}
                </View>
                <Text weight="bold" size={12} color={STRENGTH_COLORS[strength.score] ?? colors.inkTertiary}>
                  {strength.label}
                </Text>
              </View>
            )
          }
        />
        <TextField
          label="Birthday"
          value={birthday}
          onChangeText={(t) => setBirthday(formatBirthdayInput(t))}
          placeholder="MM / DD / YYYY"
          keyboardType="number-pad"
          trailing={<Icon name="calendar" size={20} color={colors.inkTertiary} />}
          hint={
            <Text size={12} color={birthdayInvalid ? colors.orange : colors.inkTertiary}>
              {birthdayInvalid ? 'That date doesn’t look right.' : 'For 21+ deals. Never shown on your profile.'}
            </Text>
          }
        />

        <Pressable
          onPress={() => setAgreed((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          style={styles.terms}>
          <View style={[styles.checkbox, agreed && styles.checked]}>
            {agreed && <Icon name="check" size={14} color={colors.surface} />}
          </View>
          <Text size={13} color={colors.inkSecondary}>
            I agree to the{' '}
            <Text weight="bold" size={13}>
              Terms
            </Text>{' '}
            and{' '}
            <Text weight="bold" size={13}>
              Privacy Policy
            </Text>
          </Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Button
          label="Create account"
          onPress={create}
          style={styles.ctaButton}
          disabled={!valid}
        />
        <View style={styles.logIn}>
          <Text size={13} color={colors.inkSecondary}>
            Already have an account?
          </Text>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
            <Text weight="bold" size={13} color={colors.orange}>
              Log in
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function UsernameStatus({ handle }: { handle: string }) {
  const available = isUsernameAvailable(handle);
  const label = available ? 'Available' : isUsernameValid(handle) ? 'Taken' : 'a–z, 0–9, _ .';
  return (
    <View style={styles.status}>
      {available && <Icon name="check" size={14} color={colors.success} />}
      <Text weight="bold" size={13} color={available ? colors.success : colors.orange}>
        {label}
      </Text>
    </View>
  );
}

function StudentPill() {
  return (
    <View style={styles.studentPill}>
      <Icon name="student" size={12} color={colors.orange} />
      <Text weight="bold" size={12} color={colors.orange}>
        Student
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { gap: 14, paddingTop: 6, paddingHorizontal: gutter + 4, paddingBottom: 24 },
  dots: { fontSize: 16, letterSpacing: 1.6 },
  strength: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bars: { flexDirection: 'row', gap: 4 },
  bar: { width: 40, height: 4, borderRadius: 2 },
  terms: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checked: { borderColor: colors.orange, backgroundColor: colors.orange },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  studentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
    paddingRight: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.orangeSoft,
  },
  cta: { gap: 10, paddingTop: 10, paddingHorizontal: gutter + 4, alignItems: 'center', backgroundColor: colors.surface },
  ctaButton: { alignSelf: 'stretch', paddingVertical: 17 },
  logIn: { flexDirection: 'row', gap: 4 },
});
