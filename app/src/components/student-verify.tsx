import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { eduDomain } from '@/lib/account';
import { colors, fonts, radii } from '@/theme';

type Props = {
  /** The verified domain, once there is one. */
  domain: string | null;
  onVerified: (domain: string) => void;
};

// Figma "Student verify" (Sign in): .edu email in, student-only deals unlocked.
export function StudentVerify({ domain, onVerified }: Props) {
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
