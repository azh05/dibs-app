import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Icon, type IconName } from '@/components/icon';
import { ProgressBar } from '@/components/progress-bar';
import { StudentVerify } from '@/components/student-verify';
import { Text } from '@/components/text';
import { initials, schoolName, shortName } from '@/lib/account';
import {
  BADGES,
  BADGE_TOTAL,
  BADGES_EARNED,
  DEAL_DNA,
  FRIEND_ACTIVITY,
  INVITES,
  LEADERBOARDS,
  PROFILE_STATS,
  inviteFriends,
  levelFor,
} from '@/lib/social';
import { useStore } from '@/lib/store';
import { colors, gutter, radii } from '@/theme';

const ACTIVITY_BUTTON = { save: ['Save', 'Saved'], cheer: ['Cheer', 'Cheered'] } as const;

const editInterests = () => router.push({ pathname: '/onboarding/interests', params: { edit: '1' } });

// 18 · Profile (Figma 50:1552). Stats, badges, friends and the leaderboard are mock data until
// there is a social backend.
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const store = useStore();
  const { account, studentDomain, xp, saved, used, topics, instant, alertRadiusMi, cheered } = store;
  const [verifying, setVerifying] = useState(false);

  if (!account) {
    return (
      <View style={[styles.screen, styles.signedOut, { paddingTop: insets.top + 40 }]}>
        <Text weight="extrabold" size={22} tracking={-0.44}>
          Sign in to track your savings
        </Text>
        <Button label="Sign in" onPress={() => router.push('/onboarding/sign-in')} />
      </View>
    );
  }

  const level = levelFor(xp);
  const rank = LEADERBOARDS.Westwood.you.rank;
  const school = studentDomain ? schoolName(studentDomain) : null;
  const dealsUsed = PROFILE_STATS.dealsUsed + used.size;

  const openSettings = () =>
    Alert.alert('Settings', undefined, [
      { text: 'Edit interests', onPress: editInterests },
      { text: 'Alert settings', onPress: () => router.navigate('/alerts') },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          store.signOut();
          router.replace('/');
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Text weight="bold" size={15}>
            @{account.username}
          </Text>
          <View style={styles.topIcons}>
            <Pressable
              onPress={() => router.navigate('/friends')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Friends">
              <Icon name="users" size={22} />
            </Pressable>
            <Pressable onPress={openSettings} hitSlop={8} accessibilityRole="button" accessibilityLabel="Settings">
              <Icon name="gear" size={22} />
            </Pressable>
          </View>
        </View>

        <View style={styles.identity}>
          <Avatar
            initials={initials(account.name)}
            size={76}
            tone="orange"
            ring={{ width: 4, color: colors.orangeSoft }}
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Text weight="extrabold" size={22} tracking={-0.44}>
              {shortName(account.name)}
            </Text>
            <Text size={13} color={colors.inkTertiary}>
              {school ? `${school} · Westwood` : 'Westwood'}
            </Text>
            <View style={styles.identityMeta}>
              {school && (
                <View style={styles.studentPill}>
                  <Icon name="student" size={12} color={colors.orange} />
                  <Text weight="bold" size={11} color={colors.orange}>
                    Verified student
                  </Text>
                </View>
              )}
              <Text weight="bold" size={12} color={colors.inkSecondary}>
                {PROFILE_STATS.friends} friends
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.level}>
          <View style={styles.rowBetween}>
            <View style={{ gap: 2 }}>
              <Text weight="extrabold" size={11} tracking={1.1} color={colors.orange}>
                LEVEL {level.level}
              </Text>
              <Text weight="extrabold" size={22} tracking={-0.44} color={colors.surface}>
                {level.name}
              </Text>
            </View>
            <View style={styles.levelBadge}>
              <Text weight="extrabold" size={26} tracking={-0.78} color={colors.surface}>
                {level.level}
              </Text>
            </View>
          </View>
          <ProgressBar value={level.progress / level.goal} track="rgba(255,255,255,0.14)" />
          <View style={styles.rowBetween}>
            <Text weight="bold" size={12} color={colors.surface}>
              {level.progress.toLocaleString()} / {level.goal.toLocaleString()} XP
            </Text>
            {level.next && (
              <Text size={12} color={colors.inkTertiary}>
                {(level.goal - level.progress).toLocaleString()} XP to {level.next}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.stats}>
          <Stat value={`$${PROFILE_STATS.savedDollars}`} label="saved so far" highlight />
          <Stat value={String(dealsUsed)} label="deals used" />
          <Stat value={String(PROFILE_STATS.weekStreak)} label="week streak" icon="flame" />
        </View>

        <View style={styles.rank}>
          <View style={{ flex: 1 }}>
            <Text weight="extrabold" size={22} tracking={-0.44} color={colors.surface}>
              #{rank} in Westwood
            </Text>
            <Text weight="semibold" size={13} color={colors.orangeSoft}>
              Top 3% at {school ?? 'school'} this month
            </Text>
          </View>
          <Pressable onPress={() => router.push('/leaderboard')} accessibilityRole="button" style={styles.rankButton}>
            <Text weight="bold" size={13}>
              Leaderboard
            </Text>
            <Icon name="chevron" size={14} />
          </Pressable>
        </View>

        <View style={{ gap: 12 }}>
          <SectionTitle title="Badges" meta={`${BADGES_EARNED} of ${BADGE_TOTAL}`} />
          <View style={styles.badges}>
            {BADGES.map((b) => (
              <View key={b.name} style={styles.badge}>
                <View
                  style={[
                    styles.badgeCircle,
                    b.featured ? styles.badgeFeatured : b.earned ? styles.badgeEarned : styles.badgeLocked,
                  ]}>
                  <Icon
                    name={b.icon}
                    size={b.earned ? 24 : 20}
                    color={b.featured ? colors.surface : b.earned ? colors.orange : colors.inkTertiary}
                  />
                </View>
                <Text
                  weight="bold"
                  size={11}
                  color={b.earned ? colors.ink : colors.inkTertiary}
                  style={{ textAlign: 'center' }}>
                  {b.name}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.dna}>
          <SectionTitle title="Your deal DNA" meta="This month" />
          <View style={styles.dnaBar}>
            {DEAL_DNA.slices.map((s) => (
              <View key={s.label} style={[styles.dnaSlice, { flex: s.percent, backgroundColor: s.color }]} />
            ))}
          </View>
          <View style={styles.legend}>
            {DEAL_DNA.slices.map((s) => (
              <View key={s.label} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                <Text weight="semibold" size={12} color={colors.inkSecondary}>
                  {s.label} {s.percent}%
                </Text>
              </View>
            ))}
          </View>
          <Text weight="semibold" size={13}>
            {DEAL_DNA.summary}
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          <SectionTitle title="My lists" action="See all" onAction={() => router.push('/saved')} />
          <View style={styles.lists}>
            <ListTile icon="bookmark" count={saved.size} label="Saved" tone="orange" onPress={() => router.push('/saved')} />
            <ListTile icon="calendar" count={12} label="Want to try" tone="soft" />
            <ListTile icon="check" count={dealsUsed} label="Used" tone="muted" />
          </View>
        </View>

        <View style={{ gap: 4 }}>
          <SectionTitle title="Friends" action="Find friends" onAction={() => router.navigate('/friends')} />
          {FRIEND_ACTIVITY.map((a) => {
            const done = a.savesId ? saved.has(a.savesId) : cheered.has(a.id);
            return (
              <View key={a.id} style={styles.activity}>
                <Avatar initials={a.friend.initials} size={40} tone={a.friend.tone} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text size={13} color={colors.inkSecondary}>
                    <Text weight="bold" size={13}>
                      {a.friend.name}
                    </Text>{' '}
                    {a.verb}{' '}
                    <Text weight="bold" size={13}>
                      {a.subject}
                    </Text>
                    {a.place ? ` at ${a.place}` : ''}
                  </Text>
                  <Text size={11} color={colors.inkTertiary}>
                    {a.ago}
                  </Text>
                </View>
                <Pressable
                  onPress={() => (a.savesId ? store.toggleSaved(a.savesId) : store.toggleCheer(a.id))}
                  accessibilityRole="button"
                  style={[styles.smallButton, done && styles.smallButtonDone]}>
                  <Text weight="bold" size={12} color={done ? colors.orange : colors.ink}>
                    {ACTIVITY_BUTTON[a.action][done ? 1 : 0]}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={styles.invite}>
          <Icon name="gift" size={26} color={colors.orange} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="extrabold" size={14} tracking={-0.14}>
              Invite friends, you both get {INVITES.reward} credits
            </Text>
            <Text size={12} color={colors.inkSecondary}>
              {INVITES.joined} friends joined · {INVITES.earned.toLocaleString()} credits earned
            </Text>
          </View>
          <Pressable onPress={inviteFriends} accessibilityRole="button" style={styles.inviteButton}>
            <Text weight="bold" size={13} color={colors.surface}>
              Invite
            </Text>
          </Pressable>
        </View>

        <View style={styles.settings}>
          <SettingRow icon="sliders" title="Edit interests" value={`${topics.size} picked`} onPress={editInterests} />
          <SettingRow
            icon="bell"
            title="Alert settings"
            value={`${instant ? 'Instant' : 'Off'} · ${alertRadiusMi} mi`}
            onPress={() => router.navigate('/alerts')}
          />
          <SettingRow
            icon="student"
            title="Student verification"
            value={studentDomain ? `${studentDomain} ✓` : 'Verify'}
            valueColor={studentDomain ? colors.success : colors.orange}
            onPress={() => !studentDomain && setVerifying((v) => !v)}
            last
          />
        </View>
        {verifying && !studentDomain && <StudentVerify domain={null} onVerified={store.setStudentDomain} />}
      </ScrollView>
    </View>
  );
}

function SectionTitle({ title, meta, action, onAction }: { title: string; meta?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.rowBetween}>
      <Text weight="extrabold" size={18} tracking={-0.18}>
        {title}
      </Text>
      {meta && (
        <Text weight="bold" size={13} color={colors.inkTertiary}>
          {meta}
        </Text>
      )}
      {action && (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text weight="bold" size={13} color={colors.orange}>
            {action}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function Stat({ value, label, icon, highlight = false }: { value: string; label: string; icon?: IconName; highlight?: boolean }) {
  return (
    <View style={[styles.stat, { backgroundColor: highlight ? colors.orangeSoft : colors.muted }]}>
      <View style={styles.statValue}>
        {icon && <Icon name={icon} size={18} color={colors.orange} />}
        <Text weight="extrabold" size={24} tracking={-0.72} color={highlight ? colors.orange : colors.ink}>
          {value}
        </Text>
      </View>
      <Text weight="semibold" size={12} color={colors.inkSecondary}>
        {label}
      </Text>
    </View>
  );
}

const LIST_TONES = {
  orange: { bg: colors.orange, fg: colors.surface, sub: colors.orangeSoft },
  soft: { bg: colors.orangeSoft, fg: colors.ink, sub: colors.inkSecondary },
  muted: { bg: colors.muted, fg: colors.ink, sub: colors.inkSecondary },
} as const;

function ListTile({
  icon,
  count,
  label,
  tone,
  onPress,
}: {
  icon: IconName;
  count: number;
  label: string;
  tone: keyof typeof LIST_TONES;
  onPress?: () => void;
}) {
  const t = LIST_TONES[tone];
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.listTile, { backgroundColor: t.bg }]}>
      <Icon name={icon} size={18} color={t.fg} />
      <Text weight="extrabold" size={22} tracking={-0.66} color={t.fg} style={{ marginTop: 14 }}>
        {count}
      </Text>
      <Text weight="semibold" size={12} color={t.sub}>
        {label}
      </Text>
    </Pressable>
  );
}

function SettingRow({
  icon,
  title,
  value,
  valueColor = colors.inkTertiary,
  onPress,
  last = false,
}: {
  icon: IconName;
  title: string;
  value: string;
  valueColor?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.settingRow, !last && styles.divider]}>
      <Icon name={icon} size={20} />
      <Text weight="bold" size={14} style={{ flex: 1 }}>
        {title}
      </Text>
      <Text size={13} color={valueColor}>
        {value}
      </Text>
      <Icon name="chevron" size={16} color={colors.inkTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  signedOut: { alignItems: 'center', gap: 16, paddingHorizontal: gutter },
  content: { gap: 16, paddingTop: 4, paddingHorizontal: gutter, paddingBottom: 32 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topIcons: { flexDirection: 'row', gap: 16 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  identityMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  studentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
    paddingRight: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.orangeSoft,
  },
  level: { gap: 12, padding: 16, borderRadius: 22, backgroundColor: colors.ink },
  levelBadge: {
    width: 52,
    height: 52,
    borderRadius: radii.button,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, gap: 2, padding: 14, borderRadius: radii.card },
  statValue: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rank: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 22, backgroundColor: colors.orange },
  rankButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  badges: { flexDirection: 'row', gap: 10 },
  badge: { flex: 1, alignItems: 'center', gap: 6 },
  badgeCircle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  badgeFeatured: { backgroundColor: colors.orange, borderWidth: 3, borderColor: colors.orangeSoft },
  badgeEarned: { backgroundColor: colors.orangeSoft, borderWidth: 1.5, borderColor: colors.orange },
  badgeLocked: { backgroundColor: colors.muted, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed' },
  dna: { gap: 12, padding: 16, borderRadius: 22, backgroundColor: colors.muted },
  dnaBar: { flexDirection: 'row', gap: 3 },
  dnaSlice: { height: 14, borderRadius: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  lists: { flexDirection: 'row', gap: 10 },
  listTile: { flex: 1, gap: 2, padding: 12, borderRadius: 18 },
  activity: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  smallButtonDone: { borderColor: colors.orange, backgroundColor: colors.orangeSoft },
  invite: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 22, backgroundColor: colors.orangeSoft },
  inviteButton: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radii.pill, backgroundColor: colors.orange },
  settings: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, overflow: 'hidden' },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
});
