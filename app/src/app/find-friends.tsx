import { useMutation, useQuery } from 'convex/react';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { SearchBar } from '@/components/search-bar';
import { Overline } from '@/components/section-header';
import { Text } from '@/components/text';
import { errorText } from '@/lib/backend';
import { colors, gutter } from '@/theme';

type Person = { id: Id<'users'>; name: string; username: string | null; initials: string };

// Find friends (Profile → Friends → "Find friends"): search by name or @username, answer requests. Friends' used deals,
// saved events and badges then show on Profile, and they get their own leaderboard. Backend mode only.
export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const results = useQuery(api.social.findPeople, { query });
  const lists = useQuery(api.social.friends);
  const request = useMutation(api.social.request);
  const respond = useMutation(api.social.respond);
  const [sent, setSent] = useState(new Set<string>());

  const known = new Set(
    [...(lists?.friends ?? []), ...(lists?.outgoing ?? []), ...(lists?.incoming ?? [])].map((p) => p.id),
  );
  const add = (p: Person) => {
    setSent((s) => new Set(s).add(p.id));
    request({ userId: p.id }).catch((e) => {
      setSent((s) => {
        const next = new Set(s);
        next.delete(p.id);
        return next;
      });
      Alert.alert('Couldn’t add friend', errorText(e));
    });
  };
  const answer = (p: Person, accept: boolean) =>
    respond({ userId: p.id, accept }).catch((e) => Alert.alert('Something went wrong', errorText(e)));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="back" size={22} />
        </Pressable>
        <Text weight="extrabold" size={26} tracking={-0.78}>
          Friends
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search by name or @username" compact />

        {query.trim().length >= 2 && (
          <View style={{ gap: 2 }}>
            <Overline>RESULTS</Overline>
            {(results ?? []).map((p) => (
              <PersonRow key={p.id} person={p}>
                {known.has(p.id) || sent.has(p.id) ? (
                  <Text weight="bold" size={13} color={colors.inkTertiary}>
                    Added
                  </Text>
                ) : (
                  <SmallButton label="Add" onPress={() => add(p)} />
                )}
              </PersonRow>
            ))}
            {results?.length === 0 && (
              <Text size={14} color={colors.inkTertiary}>
                No one goes by that yet.
              </Text>
            )}
          </View>
        )}

        {!!lists?.incoming.length && (
          <View style={{ gap: 2 }}>
            <Overline>REQUESTS</Overline>
            {lists.incoming.map((p) => (
              <PersonRow key={p.id} person={p}>
                <SmallButton label="Accept" onPress={() => answer(p, true)} primary />
                <SmallButton label="Decline" onPress={() => answer(p, false)} />
              </PersonRow>
            ))}
          </View>
        )}

        <View style={{ gap: 2 }}>
          <Overline>{`YOUR FRIENDS · ${lists?.friends.length ?? 0}`}</Overline>
          {lists?.friends.map((p) => (
            <PersonRow key={p.id} person={p}>
              <SmallButton label="Remove" onPress={() => answer(p, false)} />
            </PersonRow>
          ))}
          {lists?.outgoing.map((p) => (
            <PersonRow key={p.id} person={p}>
              <Text weight="bold" size={13} color={colors.inkTertiary}>
                Requested
              </Text>
            </PersonRow>
          ))}
          {lists && lists.friends.length === 0 && lists.outgoing.length === 0 && (
            <Text size={14} color={colors.inkTertiary}>
              Search for friends above, or invite them from your profile.
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function PersonRow({ person, children }: { person: Person; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Avatar initials={person.initials} size={40} tone="soft" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="bold" size={14}>
          {person.name}
        </Text>
        {person.username && (
          <Text size={12} color={colors.inkTertiary}>
            @{person.username}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}

function SmallButton({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.button, primary && styles.primary]}>
      <Text weight="bold" size={12} color={primary ? colors.surface : colors.ink}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: gutter, paddingVertical: 12 },
  content: { gap: 20, paddingHorizontal: gutter, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  button: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  primary: { backgroundColor: colors.orange, borderColor: colors.orange },
});
