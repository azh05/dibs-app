import { useUser } from '@clerk/expo';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { eduDomain } from '@/lib/account';
import { usingBackend } from '@/lib/backend';
import { clerkError } from '@/lib/clerk-auth';
import { colors, fonts, radii } from '@/theme';

type Props = {
  /** The verified domain, once there is one. */
  domain: string | null;
  onVerified: (domain: string) => void;
  /** Backend, before sign-in: there is no account to add the address to, so hand it to sign-up. */
  onNeedsAccount?: (email: string) => void;
};

// Figma "Student verify" (Sign in): .edu email in, student-only deals unlocked. With the backend the address is
// added to the Clerk account and confirmed with an emailed 6-digit code; Clerk's webhook then tells Convex.
export function StudentVerify(props: Props) {
  return usingBackend ? <ClerkStudentVerify {...props} /> : <LocalStudentVerify {...props} />;
}

type EmailResource = NonNullable<ReturnType<typeof useUser>['user']>['emailAddresses'][number];

function ClerkStudentVerify({ domain, onNeedsAccount }: Props) {
  const { user } = useUser();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<EmailResource | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (step: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (e) {
      setError(clerkError(e));
    } finally {
      setBusy(false);
    }
  };

  const send = () =>
    run(async () => {
      if (!eduDomain(email)) throw new Error('Use your school email, ending in .edu');
      if (!user && onNeedsAccount) return onNeedsAccount(email.trim());
      if (!user) throw new Error('Sign in first');
      const existing = user.emailAddresses.find((e) => e.emailAddress.toLowerCase() === email.trim().toLowerCase());
      const address = existing ?? (await user.createEmailAddress({ email: email.trim() }));
      await address.prepareVerification({ strategy: 'email_code' });
      setPending(address);
    });

  const confirm = () =>
    run(async () => {
      const verified = await pending!.attemptVerification({ code: code.trim() });
      if (verified.verification.status !== 'verified') throw new Error('That code didn’t work');
      setDone(true);
    });

  const title = domain
    ? 'Student deals unlocked'
    : done
      ? 'Verified! Unlocking student deals…'
      : 'Unlock student-only deals';
  const subtitle = domain
    ? `Verified with ${domain}`
    : pending
      ? `Enter the code we sent to ${pending.emailAddress}`
      : 'Verify your .edu email. Takes 10 seconds.';

  return (
    <View style={styles.card}>
      <Header title={title} subtitle={subtitle} verified={Boolean(domain) || done} />
      {!domain && !done && (
        <>
          <View style={styles.input}>
            <TextInput
              value={pending ? code : email}
              onChangeText={(t) => {
                if (pending) setCode(t.replace(/\D/g, '').slice(0, 6));
                else setEmail(t);
                setError(null);
              }}
              placeholder={pending ? '6-digit code' : 'you@ucla.edu'}
              placeholderTextColor={colors.inkTertiary}
              keyboardType={pending ? 'number-pad' : 'email-address'}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={pending ? confirm : send}
              style={styles.field}
            />
            <Pressable
              onPress={pending ? confirm : send}
              disabled={busy}
              accessibilityRole="button"
              style={styles.verify}>
              <Text weight="bold" size={14} color={colors.surface}>
                {busy ? '…' : pending ? 'Confirm' : 'Verify'}
              </Text>
            </Pressable>
          </View>
          {error && (
            <Text weight="semibold" size={12} color={colors.orange}>
              {error}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

function Header({ title, subtitle, verified }: { title: string; subtitle: string; verified: boolean }) {
  return (
    <View style={styles.header}>
      <View style={styles.thumb}>
        <Icon name="student" size={18} color={colors.orange} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="extrabold" size={15} tracking={-0.15}>
          {title}
        </Text>
        <Text size={12} color={colors.inkSecondary}>
          {subtitle}
        </Text>
      </View>
      {verified && <Icon name="check" size={18} color={colors.success} />}
    </View>
  );
}

function LocalStudentVerify({ domain, onVerified }: Props) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verify = () => {
    const found = eduDomain(email);
    if (found) onVerified(found);
    else setError('Use your school email, ending in .edu');
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.thumb}>
          <Icon name="student" size={18} color={colors.orange} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="extrabold" size={15} tracking={-0.15}>
            {domain ? 'Student deals unlocked' : 'Unlock student-only deals'}
          </Text>
          <Text size={12} color={colors.inkSecondary}>
            {domain ? `Verified with ${domain}` : 'Verify your .edu email. Takes 10 seconds.'}
          </Text>
        </View>
        {domain && <Icon name="check" size={18} color={colors.success} />}
      </View>
      {!domain && (
        <>
          <View style={styles.input}>
            <TextInput
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                setError(null);
              }}
              placeholder="you@ucla.edu"
              placeholderTextColor={colors.inkTertiary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={verify}
              style={styles.field}
            />
            <Pressable onPress={verify} accessibilityRole="button" style={styles.verify}>
              <Text weight="bold" size={14} color={colors.surface}>
                Verify
              </Text>
            </Pressable>
          </View>
          {error && (
            <Text weight="semibold" size={12} color={colors.orange}>
              {error}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, borderRadius: radii.card, backgroundColor: colors.orangeSoft },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: radii.thumb,
    backgroundColor: colors.surface,
  },
  field: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.ink, paddingVertical: 0 },
  verify: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.orange },
});
