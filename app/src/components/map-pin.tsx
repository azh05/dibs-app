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

type Props = {
  state: PinState;
  detail?: PinDetail;
  label: string;
  store: string;
  icon: IconName;
  sourceIcon: IconName;
  /** Badge text: post age ("2h") or event day ("Sat"). */
  time: string;
};

// Figma "Map Pin" (7:618). Colour encodes recency: Fresh → 1 day → 1 week+ gets lighter.
export function MapPin({ state, detail = 'full', label, store, icon, sourceIcon, time }: Props) {
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
