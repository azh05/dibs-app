import { useQuery } from 'convex/react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { isUsernameAvailable, isUsernameValid } from '@/lib/account';
import { usingBackend } from '@/lib/backend';
import { api } from '@convex/_generated/api';
import { colors } from '@/theme';

/** Username availability: checked by Convex with the backend, against a local list in mock mode. */
function useRemoteUsername(handle: string) {
  const ok = useQuery(api.users.usernameAvailable, isUsernameValid(handle) ? { username: handle } : 'skip');
  return isUsernameValid(handle) && ok !== false;
}
export const useUsernameAvailable: (handle: string) => boolean = usingBackend ? useRemoteUsername : isUsernameAvailable;

/** What the user typed, as a handle: "@Maya" → "maya". */
export const toHandle = (typed: string) => typed.replace(/^@/, '').toLowerCase();

// Figma "Field / Username" (66:2260) on Create account: shown as @handle, with "✓ Available" / "Taken" at the edge.
export function UsernameField({
  handle,
  available,
  onChangeText,
  autoFocus,
}: {
  handle: string;
  available: boolean;
  onChangeText: (typed: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <TextField
      label="Username"
      value={handle ? `@${handle}` : ''}
      onChangeText={onChangeText}
      placeholder="@username"
      autoCapitalize="none"
      textContentType="username"
      autoFocus={autoFocus}
      trailing={handle.length >= 3 && <UsernameStatus handle={handle} available={available} />}
    />
  );
}

function UsernameStatus({ handle, available }: { handle: string; available: boolean }) {
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

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
