import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionBar, Button } from '@/components/button';
import { DetailHeader } from '@/components/detail-header';
import { DetailList, type DetailRow } from '@/components/detail-list';
import { Icon } from '@/components/icon';
import { StatusPill } from '@/components/pills';
import { Text } from '@/components/text';
import { Thumb } from '@/components/thumb';
import { CATEGORY } from '@/lib/api';
import {
  capitalize,
  checkPhoto,
  fineprint,
  isEligible,
  noDealReason,
  pickPhoto,
  statusLabel,
  verdictNote,
  whenNote,
  whenText,
  type Photo,
} from '@/lib/photo';
import { useStore } from '@/lib/store';
import type { ApiDeal, ApiSearchResponse } from '@/lib/types';
import { colors, gutter } from '@/theme';

type Check = { state: 'reading' } | { state: 'done'; res: ApiSearchResponse } | { state: 'error'; message: string };
/** A finished check, tagged with the photo and attempt it answers. */
type Answer = Exclude<Check, { state: 'reading' }> & { key: string };

function rowsFor(deal: ApiDeal): DetailRow[] {
  const rows: DetailRow[] = [
    { key: 'when', icon: <Icon name="clock" size={20} />, title: whenText(deal), subtitle: whenNote(deal) },
  ];
  if (deal.code) {
    rows.push({
      key: 'code',
      icon: <Icon name="percent" size={20} />,
      title: `Code ${deal.code}`,
      subtitle: 'Found in the poster’s text',
    });
  }
  const [first, ...rest] = fineprint(deal);
  if (first) {
    rows.push({
      key: 'conditions',
      icon: <Icon name="tag" size={20} />,
      title: capitalize(first),
      subtitle: rest.length ? rest.join(' · ') : 'Fine print from the poster',
    });
  }
  rows.push(
    {
      key: 'source',
      icon: <Icon name="camera" size={20} />,
      title: 'Read from your photo',
      subtitle: 'Every quote checked against what we read',
    },
    {
      key: 'quote',
      icon: <Icon name="check" size={20} color={colors.success} />,
      title: 'Quote found on the poster',
      subtitle: verdictNote(deal),
    },
  );
  return rows;
}

// 07b · Submission result (Figma 25:820): what /extract/photo read off a snapped deal.
export default function SubmissionResult() {
  const params = useLocalSearchParams<Photo>();
  const insets = useSafeAreaInsets();
  const { addSubmission } = useStore();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { uri, mimeType, date } = params;
  // A retake or retry changes the key, so an answer for the old photo reads as still checking.
  const key = `${uri}#${attempt}`;
  const check: Check = answer?.key === key ? answer : { state: 'reading' };

  useEffect(() => {
    checkPhoto({ uri, mimeType, date }).then(
      (res) => setAnswer({ key, state: 'done', res }),
      (e: unknown) => setAnswer({ key, state: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  }, [key, uri, mimeType, date]);

  const deal = check.state === 'done' ? check.res.deals[0] : undefined;

  const retake = async () => {
    const photo = await pickPhoto();
    if (photo) router.setParams(photo);
  };

  const done = () => {
    // Only live deals go on to review for credits; nothing else is kept.
    if (deal && isEligible(deal)) {
      addSubmission({
        id: `s-${Date.now()}`,
        store: deal.shop_name,
        offer: deal.offer,
        icon: CATEGORY[deal.category].icon,
        status: 'review',
        photoUri: uri,
      });
    }
    router.back();
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <DetailHeader
          post={{
            author: 'Your photo',
            initials: 'ME',
            avatarColor: colors.ink,
            postedAgo: 'now',
            headline: '',
            subline: '',
            caption: deal ? `“${deal.verbatim_quote}”` : 'Reading your photo…',
            imageColor: colors.orange,
            sublineColor: colors.orangeSoft,
            headlineSize: 52,
          }}
          imageUri={uri}
          height={286}
          imageHeight={170}
        />
        <View style={styles.content}>
          {check.state === 'reading' && (
            <View style={styles.message}>
              <ActivityIndicator color={colors.orange} />
              <Text weight="extrabold" size={22} tracking={-0.44}>
                Reading your photo…
              </Text>
              <Text size={14} color={colors.inkSecondary} style={styles.center}>
                We read every word on the poster, then check each quote against it.
              </Text>
            </View>
          )}

          {check.state === 'error' && (
            <View style={styles.message}>
              <Text weight="extrabold" size={22} tracking={-0.44}>
                Couldn’t check this photo
              </Text>
              <Text size={14} color={colors.inkSecondary} style={styles.center}>
                {check.message}
              </Text>
              <Button label="Try again" variant="outline" onPress={() => setAttempt((n) => n + 1)} />
            </View>
          )}

          {check.state === 'done' && !deal && (
            <View style={styles.message}>
              <Text weight="extrabold" size={22} tracking={-0.44}>
                No deal found
              </Text>
              <Text size={14} color={colors.inkSecondary} style={styles.center}>
                {noDealReason(check.res)}
              </Text>
            </View>
          )}

          {deal && <DealResult deal={deal} />}

          <View style={styles.trust}>
            <Icon name="zap" size={16} color={colors.orange} />
            <Text weight="semibold" size={12} color={colors.inkSecondary} style={{ flex: 1 }}>
              Only live deals earn credits. Nothing is stored yet.
            </Text>
          </View>
        </View>
      </ScrollView>
      <ActionBar bottomInset={insets.bottom}>
        <Button label="Retake" icon="camera" variant="outline" onPress={retake} />
        <Button label="Done" icon="check" onPress={done} style={{ flex: 1 }} />
      </ActionBar>
    </View>
  );
}

function DealResult({ deal }: { deal: ApiDeal }) {
  const category = CATEGORY[deal.category];
  const status = statusLabel(deal);
  return (
    <>
      <View style={styles.store}>
        <Thumb icon={category.icon} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="bold" size={16}>
            {deal.shop_name}
          </Text>
          <Text size={13} color={colors.inkTertiary}>
            {category.label} · read from your photo
          </Text>
        </View>
      </View>
      <View style={{ gap: 10, alignItems: 'flex-start' }}>
        <Text weight="extrabold" size={30} tracking={-0.9} style={{ lineHeight: 36 }}>
          {capitalize(deal.offer)}
        </Text>
        <StatusPill label={status.label} tone={status.tone} />
      </View>
      <DetailList rows={rowsFor(deal)} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 22, paddingHorizontal: gutter, gap: 18 },
  store: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  message: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  center: { textAlign: 'center', lineHeight: 21 },
  trust: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
