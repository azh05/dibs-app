import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { RankCards } from '@/components/rank-cards';
import { StoreLogo } from '@/components/store-logo';
import { Text } from '@/components/text';
import { initials } from '@/lib/account';
import { findDeal, findEvent, useDeals } from '@/lib/api';
import { usingBackend } from '@/lib/backend';
import { inviteFriends, type FriendPost } from '@/lib/social';
import { useFriendRanks, useSocial, type AreaKey } from '@/lib/social-data';
import { useStore } from '@/lib/store';
import { colors, gutter, radii } from '@/theme';

const CARD_BUTTON = { deal: ['Save', 'Saved'], event: ['I’m in', 'You’re in'] } as const;

// 17 · Friends · scroll (Figma 102:2466): your ranks, friends ranked by $ saved in your neighbourhood or at
// your school, and friends' activity. Live from Convex (src/lib/social-data.ts), or mock data.
export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const { account } = useStore();
  const social = useSocial();
  const [scope, setScope] = useState<AreaKey>('neighborhood');
  const ranks = useFriendRanks(scope);
  const search = () =>
    usingBackend
      ? router.push('/find-friends')
      : Alert.alert('Find friends', 'Searching by name or @username works once the app is signed in to dibs.');

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.header, styles.pad]}>
          <Text weight="extrabold" size={28} tracking={-0.84}>
            Friends
          </Text>
          <View style={styles.headerIcons}>
            <Pressable
              onPress={() => inviteFriends(social.invites.code, social.invites.reward)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Add friends">
              <Icon name="user-plus" size={22} />
            </Pressable>
            <Pressable
              onPress={search}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Search friends">
              <Icon name="search" size={22} />
            </Pressable>
          </View>
        </View>

        <View style={styles.pad}>
          <RankCards />
        </View>

        <View style={[styles.pad, { gap: 2 }]}>
          <View style={styles.listHeader}>
            <View style={styles.listTitle}>
              <Text weight="extrabold" size={16} tracking={-0.16}>
                Friends
              </Text>
              <Text weight="semibold" size={13} color={colors.inkTertiary}>
                {social.stats.friends}
              </Text>
            </View>
            <View style={styles.scope}>
              {social.rankCards.map(({ key: s, label }) => (
                <Pressable
                  key={s}
                  onPress={() => setScope(s)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: s === scope }}
                  style={[styles.scopeOption, s === scope && styles.scopeOn]}>
                  <Text weight="bold" size={12} color={s === scope ? colors.ink : colors.inkTertiary}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {ranks.length === 0 && (
            <Text size={13} color={colors.inkTertiary} style={{ paddingVertical: 8 }}>
              No one is ranked here yet this month. Mark a deal “Used it” to get on the board.
            </Text>
          )}
          {ranks.map((f) => (
            <View key={f.name} style={[styles.friendRow, f.you && styles.youRow]}>
              <Text
                weight="extrabold"
                size={13}
                color={f.you ? colors.orange : colors.inkTertiary}
                style={styles.rankNumber}>
                #{f.rank}
              </Text>
              <Avatar initials={f.you && account ? initials(account.name) : f.initials} size={36} tone={f.tone} />
              <Text weight="bold" size={14} style={{ flex: 1 }}>
                {f.name}
              </Text>
              <Text weight="extrabold" size={14}>
                ${f.saved}
              </Text>
            </View>
          ))}
          <Pressable
            onPress={() => router.navigate({ pathname: '/leaderboard', params: { scope: 'Friends' } })}
            accessibilityRole="button"
            style={styles.showAll}>
            <Text weight="bold" size={13}>
              Show all {social.stats.friends} friends
            </Text>
            <View style={{ transform: [{ rotate: '90deg' }] }}>
              <Icon name="chevron" size={14} />
            </View>
          </Pressable>
        </View>

        <View style={[styles.pad, { gap: 12 }]}>
          <Text weight="extrabold" size={16} tracking={-0.16}>
            Activity
          </Text>
          {social.posts.length === 0 && (
            <Text size={13} color={colors.inkTertiary}>
              When friends use deals or save events, it shows up here.
            </Text>
          )}
          {social.posts.map((p) => (
            <Post key={p.id} post={p} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Post({ post: p }: { post: FriendPost }) {
  const { deals } = useDeals();
  const { saved, toggleSaved, liked, toggleLiked } = useStore();
  const isLiked = liked.has(p.id);
  const card = p.card;
  const target = card && (card.kind === 'deal' ? findDeal(deals, card.id) : findEvent(card.id));
  const open = () => card && router.push(card.kind === 'deal' ? `/deal/${card.id}` : `/event/${card.id}`);
  const done = card ? saved.has(card.id) : false;

  return (
    <View style={styles.post}>
      <View style={styles.postHeader}>
        <Avatar initials={p.friend.initials} size={36} tone={p.friend.tone} />
        <Text size={13} weight="medium" color={colors.inkSecondary} style={{ flex: 1 }}>
          <Text weight="extrabold" size={13}>
            {p.friend.name}
          </Text>{' '}
          {p.verb}{' '}
          <Text weight="extrabold" size={13}>
            {p.subject}
          </Text>
        </Text>
        <Text weight="medium" size={11} color={colors.inkTertiary}>
          {p.ago}
        </Text>
      </View>

      {card && (
        <Pressable onPress={open} accessibilityRole="button" style={styles.card}>
          <StoreLogo logo={target?.logo ?? null} icon={target?.icon ?? 'tag'} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text weight="extrabold" size={14} tracking={-0.14} numberOfLines={1}>
              {card.title}
            </Text>
            <Text weight="medium" size={12} color={colors.inkTertiary} numberOfLines={1}>
              {card.subtitle}
            </Text>
          </View>
          <Pressable
            onPress={() => toggleSaved(card.id)}
            accessibilityRole="button"
            style={[styles.cardButton, done && styles.cardButtonDone]}>
            <Text weight="bold" size={12} color={done ? colors.orange : colors.surface}>
              {CARD_BUTTON[card.kind][done ? 1 : 0]}
            </Text>
          </Pressable>
        </Pressable>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={() => toggleLiked(p.id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={isLiked ? 'Unlike' : 'Like'}
          style={styles.action}>
          <Icon name="heart" size={17} color={isLiked ? colors.orange : colors.inkSecondary} />
          <Text weight="bold" size={12} color={isLiked ? colors.orange : colors.inkSecondary}>
            {p.likes + (isLiked ? 1 : 0)}
          </Text>
        </Pressable>
        <View style={styles.action}>
          <Icon name="message" size={17} color={colors.inkSecondary} />
          <Text weight="bold" size={12} color={colors.inkSecondary}>
            {p.comments}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 4, paddingBottom: 24, gap: 18 },
  pad: { paddingHorizontal: gutter },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6 },
  listTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scope: { flexDirection: 'row', gap: 2, padding: 3, borderRadius: radii.pill, backgroundColor: colors.muted },
  scopeOption: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill },
  scopeOn: { backgroundColor: colors.surface },
  friendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  youRow: { paddingHorizontal: 10, borderRadius: radii.thumb, backgroundColor: colors.orangeSoft },
  rankNumber: { width: 28 },
  showAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radii.thumb,
    backgroundColor: colors.muted,
  },
  post: { gap: 10, padding: 14, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: radii.thumb,
    backgroundColor: colors.muted,
  },
  cardButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.orange },
  cardButtonDone: { backgroundColor: colors.orangeSoft },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
