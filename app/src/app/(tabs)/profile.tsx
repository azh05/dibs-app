import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Icon, type IconName } from '@/components/icon';
import { ProgressBar } from '@/components/progress-bar';
import { RankCards } from '@/components/rank-cards';
import { StudentVerify } from '@/components/student-verify';
import { Text } from '@/components/text';
import { initials, schoolName, shortName } from '@/lib/account';
import { DEAL_DNA, INVITES, PROFILE_FRIENDS, PROFILE_STATS, inviteFriends, levelFor } from '@/lib/social';
import { useStore } from '@/lib/store';
import { colors, gutter, radii } from '@/theme';

const editInterests = () => router.push({ pathname: '/onboarding/interests', params: { edit: '1' } });

// 18 · Profile (Figma 50:1552). Savings, ranks and friends are mock data until there is a
// social backend.
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const store = useStore();
  const { account, studentDomain, xp, saved, used, topics, instant, alertRadiusMi } = store;
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

        <Savings />

        <RankCards />

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

        <View style={{ gap: 12 }}>
          <SectionTitle
            title={`Friends · ${PROFILE_STATS.friends}`}
            action="See all"
            onAction={() => router.navigate('/friends')}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -gutter }}
            contentContainerStyle={styles.friends}>
            {PROFILE_FRIENDS.map((f) => (
              <View key={f.name} style={styles.friend}>
                <Avatar initials={f.initials} size={52} tone={f.tone} />
                <Text weight="semibold" size={12} color={colors.inkSecondary}>
                  {f.name}
                </Text>
              </View>
            ))}
          </ScrollView>
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

// Figma "Savings" (119:2524): total saved, this week's gain and a bar per week.
function Savings() {
  const weeks = PROFILE_STATS.weeklySaved;
  const max = Math.max(...weeks);
  const thisWeek = weeks[weeks.length - 1];
  return (
    <View style={styles.savings}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="extrabold" size={11} tracking={1.1} color={colors.orange}>
          SAVED SO FAR
        </Text>
        <Text weight="extrabold" size={30} tracking={-0.9}>
          ${PROFILE_STATS.savedDollars}
        </Text>
        <Text weight="semibold" size={12} color={colors.inkSecondary}>
          Since you joined in {PROFILE_STATS.joinedMonth}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <View style={styles.weekPill}>
          <Text weight="bold" size={12} color={colors.success}>
            ▲ ${thisWeek} this week
          </Text>
        </View>
        <View style={styles.bars}>
          {weeks.map((w, i) => (
            <View
              key={i}
              style={[styles.bar, { height: Math.max(4, (w / max) * 30), opacity: i === weeks.length - 1 ? 1 : 0.35 }]}
            />
          ))}
        </View>
      </View>
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
  savings: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 22, backgroundColor: colors.orangeSoft },
  weekPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.surface },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  bar: { width: 7, borderRadius: 2, backgroundColor: colors.orange },
  friends: { gap: 14, paddingHorizontal: gutter },
  friend: { alignItems: 'center', gap: 6 },
  dna: { gap: 12, padding: 16, borderRadius: 22, backgroundColor: colors.muted },
  dnaBar: { flexDirection: 'row', gap: 3 },
  dnaSlice: { height: 14, borderRadius: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  lists: { flexDirection: 'row', gap: 10 },
  listTile: { flex: 1, gap: 2, padding: 12, borderRadius: 18 },
  invite: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 22, backgroundColor: colors.orangeSoft },
  inviteButton: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radii.pill, backgroundColor: colors.orange },
  settings: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, overflow: 'hidden' },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
});
