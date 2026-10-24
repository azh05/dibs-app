import { StyleSheet, View } from 'react-native';

import TailDay from '@/assets/shapes/tail-day.svg';
import TailFresh from '@/assets/shapes/tail-fresh.svg';
import TailSelected from '@/assets/shapes/tail-selected.svg';
import TailUpcoming from '@/assets/shapes/tail-upcoming.svg';
import TailWeek from '@/assets/shapes/tail-week.svg';
import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/text';
import { PIN_COLORS, type PinState } from '@/lib/format';
import { colors, radii } from '@/theme';

const TAILS = { fresh: TailFresh, day: TailDay, week: TailWeek, selected: TailSelected, upcoming: TailUpcoming };

/**
 * How much a pin shows. `full` is the Figma pin; zoomed out, pins drop the store name and the
 * source/age badge (`compact`), then the deal label (`icon`). The tapped deal's card shows all of it.
 */
export type PinDetail = 'full' | 'compact' | 'icon';

// Fixed geometry (Figma 7:618): body 33 tall, 7px tail overlapping it by 3, store label 6 + 14 below.
const BODY_H = 33;
const TIP_Y = BODY_H - 3 + 7;

// Every pin, whatever it shows, is a fixed 40 × 37 frame with the tail tip at its bottom centre.
// iOS map markers are positioned from their view's size, and react-native-maps never shrinks or
// re-centres them, so a pin that changed size (icon → full when tapped) drifted off its location.
// The wider content is drawn as overflow, centred on the tip; taps land on the frame (the pin body).
const FRAME = { width: 40, height: TIP_Y };
const OVERFLOW_W = 300;

/** Anchor on the tail tip (Android / Google Maps; Apple Maps uses `pinCenterOffset`). */
export const pinAnchor = { x: 0.5, y: 1 };

/**
 * Apple Maps: react-native-maps keeps a marker's bottom edge near the location as its view grows, so
 * only a small nudge puts the tail tip on the spot. Measured against native pins on iOS 26.
 */
export const pinCenterOffset = { x: 0, y: -9 };

/** Rough text widths for Plus Jakarta Sans: 12px extrabold labels, 11px bold store names and badges. */
const CHAR_W = { label: 7.3, small: 6.3 };
const BADGE_GAP = 4;

/**
 * The area a pin covers at a given detail, in points relative to its tail tip (x right, y down):
 * the body and tail above the tip, plus, at full detail, the store name below and the badge to the right.
 */
export function pinFootprint(detail: PinDetail, label: string, store: string, time: string) {
  const bodyW = detail === 'icon' ? 34 : 46 + label.length * CHAR_W.label;
  if (detail !== 'full') return { left: -bodyW / 2, right: bodyW / 2, top: -TIP_Y, bottom: 0 };
  const storeW = store.length * CHAR_W.small;
  const badgeW = 26 + time.length * CHAR_W.small;
  return {
    left: -Math.max(bodyW, storeW) / 2,
    right: Math.max(bodyW / 2 + BADGE_GAP + badgeW, storeW / 2),
    top: -TIP_Y,
    bottom: 18,
  };
}

type Props = {
  state: PinState;
  detail?: PinDetail;
  label: string;
  store: string;
  icon: IconName;
  sourceIcon: IconName;
  /** Badge text: post age ("2h") or event day ("Sat"). */
  time: string;
  /** Nearby pins folded into this one; shown as "+N" on the body. */
  folded?: number;
};

// Figma "Map Pin" (7:618). Colour encodes recency: Fresh → 1 day → 1 week+ gets lighter.
export function MapPin({ state, detail = 'full', label, store, icon, sourceIcon, time, folded = 0 }: Props) {
  const upcoming = state === 'upcoming';
  const week = state === 'week';
  const full = detail === 'full';
  const Tail = TAILS[state];
  const bodyColor = state === 'selected' ? colors.ink : upcoming ? colors.surface : PIN_COLORS[state];
  const fg = upcoming ? colors.orange : colors.surface;
  const badgeColor = upcoming ? colors.orange : week ? colors.inkTertiary : colors.inkSecondary;

  const badge = (
    <View style={styles.badge}>
      <Icon name={sourceIcon} size={11} color={badgeColor} />
      <Text weight="bold" size={11} color={badgeColor} style={styles.small}>
        {time}
      </Text>
    </View>
  );

  return (
    <View style={FRAME}>
      <View style={styles.overflow} pointerEvents="box-none">
        <View style={styles.root}>
          {full && (
            <View style={styles.mirror} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              {badge}
            </View>
          )}
          <View style={styles.marker}>
            <View
              style={[
                styles.body,
                { backgroundColor: bodyColor },
                upcoming ? styles.bodyUpcoming : styles.bodyFilled,
                detail === 'icon' && styles.bodyIcon,
              ]}>
              <Icon name={upcoming ? 'calendar' : icon} size={14} color={fg} />
              {detail !== 'icon' && (
                <Text weight="extrabold" size={12} color={fg} numberOfLines={1}>
                  {label}
                </Text>
              )}
              {folded > 0 && (
                <View style={styles.count}>
                  <Text weight="extrabold" size={10} color={colors.surface}>
                    +{folded}
                  </Text>
                </View>
              )}
            </View>
            <View style={[styles.tail, full && { marginBottom: -3 }]}>
              <Tail width={12} height={7} color={colors.ink} />
            </View>
            {full && (
              <Text
                weight="bold"
                size={11}
                color={week ? colors.inkSecondary : colors.ink}
                numberOfLines={1}
                style={[styles.small, { paddingTop: 6 }]}>
                {store}
              </Text>
            )}
          </View>
          {full && <View style={styles.meta}>{badge}</View>}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Centred on the frame; the badge mirror on the left keeps the tail centred in the row.
  overflow: {
    position: 'absolute',
    top: 0,
    left: (FRAME.width - OVERFLOW_W) / 2,
    width: OVERFLOW_W,
    alignItems: 'center',
  },
  root: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  marker: { alignItems: 'center' },
  meta: { paddingTop: 5 },
  mirror: { paddingTop: 5, opacity: 0 },
  body: {
    height: BODY_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 12,
    borderRadius: radii.pill,
    shadowColor: '#17171A',
    shadowOpacity: 0.16,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 4 },
  },
  bodyIcon: { paddingLeft: 8, paddingRight: 8 },
  bodyFilled: { borderWidth: 2, borderColor: colors.surface },
  bodyUpcoming: { borderWidth: 1.5, borderColor: colors.orange, borderStyle: 'dashed' },
  count: {
    position: 'absolute',
    top: -8,
    right: -10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.surface,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tail: { marginTop: -3 },
  small: { lineHeight: 14 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingLeft: 5,
    paddingRight: 7,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    shadowColor: '#17171A',
    shadowOpacity: 0.12,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
});
