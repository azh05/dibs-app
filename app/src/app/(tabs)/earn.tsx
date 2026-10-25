import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { StatusPill } from '@/components/pills';
import { Text } from '@/components/text';
import { Thumb } from '@/components/thumb';
import { pickPhoto } from '@/lib/photo';
import { useStore } from '@/lib/store';
import type { Submission } from '@/lib/types';
import { colors, gutter, radii } from '@/theme';

const STEPS = ['Snap it', 'We verify', 'Get credits'];

/** Credits per verified submission (convex/lib/credits.ts SUBMISSION_CREDITS). */
const REWARD = 500;

// 05 · Earn (Figma 5:445, "Earn $5"). Rewards are dibs credits: they have no cash value.
export default function EarnScreen() {
  const insets = useSafeAreaInsets();
  const { submissions, credits } = useStore();

  const snap = async () => {
    const photo = await pickPhoto();
    if (photo) router.push({ pathname: '/submission', params: photo });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={{ gap: 6 }}>
          <Text weight="extrabold" size={30} tracking={-0.9}>
            Spot a deal. Get credits.
          </Text>
          <Text size={14} color={colors.inkSecondary} style={{ lineHeight: 21 }}>
            Some deals only live on a poster or the menu. Snap one we haven’t found and earn {REWARD} dibs credits once
            it’s verified.
          </Text>
        </View>

        <View style={styles.reward}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="extrabold" size={48} tracking={-1.92} color={colors.surface}>
              +{REWARD}
            </Text>
            <Text weight="bold" size={15} color={colors.surface}>
              credits per verified deal
            </Text>
            <Text size={13} color={colors.orangeSoft}>
              They post after 24 hours, or once 2 people confirm it
            </Text>
          </View>
          <View style={styles.gift}>
            <Icon name="gift" size={32} color={colors.surface} />
          </View>
        </View>

        <Pressable
          onPress={snap}
          accessibilityRole="button"
          style={({ pressed }) => [styles.upload, pressed && { backgroundColor: colors.orangeSoft }]}>
          <Thumb icon="camera" size={56} />
          <Text weight="bold" size={16}>
            Snap a deal in store
          </Text>
          <Text size={13} color={colors.inkTertiary}>
            Posters, window signs, or menu changes
          </Text>
        </Pressable>

        <View style={styles.steps}>
          {STEPS.map((step, i) => (
            <View key={step} style={styles.step}>
              <View style={styles.stepNumber}>
                <Text weight="extrabold" size={11} color={colors.surface}>
                  {i + 1}
                </Text>
              </View>
              <Text weight="bold" size={13}>
                {step}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ gap: 12 }}>
          <View style={styles.submissionsHeader}>
            <Text weight="extrabold" size={18} tracking={-0.18}>
              Your submissions
            </Text>
            <Text weight="bold" size={14} color={colors.success}>
              {credits.balance.toLocaleString()} credits
              {credits.pending ? ` · ${credits.pending.toLocaleString()} pending` : ''}
            </Text>
          </View>
          {submissions.map((s) => (
            <SubmissionRow key={s.id} submission={s} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function statusText(s: Submission) {
  if (s.status === 'checking') return 'Checking…';
  if (s.status === 'review') return 'In review';
  if (s.status === 'rejected') return 'Not eligible';
  if (!s.credits) return s.credits === null ? 'Verified · confirmed' : `Verified · +${REWARD}`;
  if (s.credits.status === 'pending') return `+${s.credits.amount} pending`;
  if (s.credits.status === 'reversed') return 'Reported ended';
  return `Verified · +${s.credits.amount}`;
}

function SubmissionRow({ submission: s }: { submission: Submission }) {
  return (
    <View style={styles.submission}>
      {s.photoUri ? (
        <Image source={{ uri: s.photoUri }} style={styles.photo} />
      ) : (
        <Thumb icon={s.icon} size={40} tone="muted" />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="bold" size={14} numberOfLines={1}>
          {s.store}
        </Text>
        <Text size={12} color={colors.inkTertiary} numberOfLines={1}>
          {s.offer}
        </Text>
      </View>
      <StatusPill label={statusText(s)} tone={s.status === 'verified' ? 'success' : 'orange'} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 8, paddingHorizontal: gutter, paddingBottom: 24, gap: 20 },
  reward: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 20,
    borderRadius: 24,
    backgroundColor: colors.orange,
  },
  gift: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  upload: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
    borderRadius: 24,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.orange,
    backgroundColor: colors.surface,
  },
  steps: { flexDirection: 'row', gap: 10 },
  step: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: radii.thumb,
    backgroundColor: colors.muted,
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submissionsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  submission: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photo: { width: 40, height: 40, borderRadius: 12.8 },
});
