import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { Segmented } from '@/components/segmented';
import { Text } from '@/components/text';
import { initials, shortName } from '@/lib/account';
import { daysUntilReset, type AvatarTone, type Ranked } from '@/lib/social';
import { BOARD_SCOPES, scopeFromParam, useBoard, type BoardScope } from '@/lib/social-data';
import { useStore } from '@/lib/store';
import { colors, gutter, radii } from '@/theme';

/** Podium order left to right: 2nd, 1st, 3rd, with Figma's block heights and colours. */
const PODIUM: { place: number; height: number; avatar: number; tone: AvatarTone; block: string; text: string }[] = [
  { place: 2, height: 84, avatar: 54, tone: 'muted', block: colors.orangeSoft, text: colors.orange },
  { place: 1, height: 112, avatar: 64, tone: 'ink', block: colors.orange, text: colors.surface },
  { place: 3, height: 66, avatar: 54, tone: 'soft', block: colors.muted, text: colors.ink },
];

function change(delta: number) {
  if (delta > 0) return { text: `▲ ${delta} this week`, color: colors.success };
  if (delta < 0) return { text: `▼ ${-delta} this week`, color: colors.orange };
  return { text: '— no change', color: colors.inkTertiary };
}

// 19 · Leaderboard (Figma 51:1657): ranked by dollars saved this month (Convex boards, or mock data).
export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ scope?: string }>();
  const { account } = useStore();
  const [scope, setScope] = useState<BoardScope>(() => scopeFromParam(params.scope, []));
  const board = useBoard(scope);
  // The tab stays mounted, so a rank card opening another scope switches it here, while rendering.
  const [lastParam, setLastParam] = useState(params.scope);
  if (params.scope !== lastParam) {
    setLastParam(params.scope);
    if (params.scope) setScope(scopeFromParam(params.scope, board.labels));
  }

  const you = board.you;
  const myLabel = account ? `You · ${shortName(account.name)}` : 'You';
  const tenth = board.ranked[9]?.saved;
  const myChange = change(you?.change ?? 0);
  const toTopTen = !you
    ? 'use a deal to get ranked'
    : you.rank <= 10 || tenth == null
      ? 'in the top 10'
      : `$${tenth - you.saved} to top 10`;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 90 }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="back" size={22} />
          </Pressable>
          <Text weight="extrabold" size={26} tracking={-0.78} style={{ flex: 1 }}>
            Leaderboard
          </Text>
          <Text weight="bold" size={12} color={colors.inkTertiary}>
            Resets in {daysUntilReset()}d
          </Text>
        </View>

        <Segmented
          options={BOARD_SCOPES.map((s, i) => ({ value: s, label: board.labels[i] ?? s }))}
          value={scope}
          onChange={setScope}
        />

        <View style={styles.metric}>
          <Text size={13} color={colors.inkTertiary}>
            Ranked by
          </Text>
          <View style={styles.metricPill}>
            <Text weight="bold" size={12} color={colors.orange}>
              $ saved this month
            </Text>
          </View>
        </View>

        <View style={styles.podium}>
          {PODIUM.map((p) => {
            const person = board.ranked[p.place - 1];
            if (!person) return <View key={p.place} style={styles.place} />;
            return (
              <View key={p.place} style={styles.place}>
                <Avatar
                  initials={person.initials}
                  size={p.avatar}
                  tone={p.tone}
                  ring={{ width: 3, color: p.place === 1 ? colors.orange : colors.surface }}
                />
                <Text weight="bold" size={13}>
                  {person.name}
                </Text>
                <View style={[styles.block, { height: p.height, backgroundColor: p.block }]}>
                  <Text weight="extrabold" size={p.place === 1 ? 34 : 28} tracking={-1} color={p.text}>
                    {p.place}
                  </Text>
                  <Text weight="bold" size={13} color={p.text}>
                    ${person.saved}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <View>
          {board.ranked.slice(3).map((person, i) => (
            <RankRow key={`${person.name}-${i}`} rank={i + 4} person={person} />
          ))}
        </View>
        {board.ranked.length === 0 && (
          <Text size={14} color={colors.inkTertiary}>
            No one has saved anything here this month yet. Mark a deal “Used it” to start.
          </Text>
        )}
      </ScrollView>

      <View style={[styles.you, { bottom: 12 }]}>
        <Text weight="extrabold" size={15} color={colors.orange}>
          {you?.rank ?? '–'}
        </Text>
        <Avatar initials={account ? initials(account.name) : 'ME'} size={36} tone="orange" />
        <View style={{ flex: 1, gap: 1 }}>
          <Text weight="bold" size={14}>
            {myLabel}
          </Text>
          <Text weight="semibold" size={11} color={myChange.color}>
            {myChange.text} · {toTopTen}
          </Text>
        </View>
        <Text weight="extrabold" size={15}>
          ${you?.saved ?? 0}
        </Text>
      </View>
    </View>
  );
}

function RankRow({ rank, person }: { rank: number; person: Ranked }) {
  const delta = change(person.change);
  return (
    <View style={styles.rankRow}>
      <Text weight="extrabold" size={15} color={colors.inkTertiary} style={styles.rankNumber}>
        {rank}
      </Text>
      <Avatar initials={person.initials} size={36} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text weight="bold" size={14}>
          {person.name}
        </Text>
        <Text weight="semibold" size={11} color={delta.color}>
          {delta.text}
        </Text>
      </View>
      <Text weight="extrabold" size={15}>
        ${person.saved}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { gap: 16, paddingTop: 4, paddingHorizontal: gutter },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metricPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.orangeSoft },
  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  place: { flex: 1, alignItems: 'center', gap: 8 },
  block: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 2,
    paddingTop: 12,
    borderTopLeftRadius: radii.button,
    borderTopRightRadius: radii.button,
  },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingVertical: 10 },
  rankNumber: { minWidth: 18 },
  you: {
    position: 'absolute',
    left: gutter,
    right: gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: colors.orangeSoft,
    shadowColor: '#17171A',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
  },
});
