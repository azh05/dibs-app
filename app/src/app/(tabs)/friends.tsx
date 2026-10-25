import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { StoreLogo } from '@/components/store-logo';
import { Text } from '@/components/text';
import { findDeal, findEvent, useDeals } from '@/lib/api';
import { FRIEND_POSTS, FRIENDS_OUT, LEADERBOARDS, inviteFriends, type FriendPost } from '@/lib/social';
import { useStore } from '@/lib/store';
import { colors, gutter, radii } from '@/theme';

const CARD_BUTTON = { deal: ['Save', 'Saved'], event: ['I’m in', 'You’re in'] } as const;

// 17 · Friends (Figma 102:2466): your rank, who's out using deals, and friends' activity.
// Mock data until there is a social backend.
export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const { you } = LEADERBOARDS.Westwood;
  const out = FRIENDS_OUT.filter((f) => f.out).length;
  const trend =
    you.change > 0 ? `▲ ${you.change} this week` : you.change < 0 ? `▼ ${-you.change} this week` : 'No change';

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.header, styles.pad]}>
          <Text weight="extrabold" size={28} tracking={-0.84}>
            Friends
          </Text>
          <View style={styles.headerIcons}>
            <Pressable onPress={inviteFriends} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add friends">
              <Icon name="user-plus" size={22} />
            </Pressable>
            <Pressable
              onPress={() => Alert.alert('Find friends', 'Searching by name or @username is coming soon.')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Search friends">
              <Icon name="search" size={22} />
            </Pressable>
          </View>
        </View>

        <View style={styles.pad}>
          <View style={styles.rank}>
            <View style={styles.rankBadge}>
              <Text weight="extrabold" size={16} tracking={-0.32} color={colors.surface}>
                #{you.rank}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text weight="extrabold" size={15} tracking={-0.15} color={colors.surface}>
                #{you.rank} in Westwood
              </Text>
              <Text weight="semibold" size={12} color={colors.inkTertiary}>
                {trend} · ${you.toNext} to #{you.rank - 1}
              </Text>
            </View>
            <Pressable
              onPress={() => router.navigate('/leaderboard')}
              accessibilityRole="button"
              style={styles.rankButton}>
              <Text weight="bold" size={12}>
                Rankings
              </Text>
              <Icon name="chevron" size={14} />
            </Pressable>
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <View style={[styles.outHeader, styles.pad]}>
            <View style={styles.liveDot} />
            <Text weight="extrabold" size={16} tracking={-0.16}>
              Out now
            </Text>
            <Text weight="medium" size={13} color={colors.inkTertiary}>
              · {out} friends using deals
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.outRow}>
            {FRIENDS_OUT.map((f) => (
              <View key={f.name} style={styles.outFriend}>
                <Avatar
                  initials={f.initials}
                  size={54}
                  tone={f.tone}
                  ring={f.out ? { width: 2.5, color: colors.orange } : undefined}
                />
                <Text weight="semibold" size={12} color={colors.inkSecondary}>
                  {f.name}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={[styles.pad, { gap: 12 }]}>
          <Text weight="extrabold" size={16} tracking={-0.16}>
            Activity
          </Text>
          {FRIEND_POSTS.map((p) => (
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
  rank: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 14,
    borderRadius: radii.card,
    backgroundColor: colors.ink,
  },
  rankBadge: {
    width: 46,
    height: 46,
    borderRadius: radii.thumb,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  outHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  outRow: { gap: 14, paddingHorizontal: gutter },
  outFriend: { alignItems: 'center', gap: 6 },
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
