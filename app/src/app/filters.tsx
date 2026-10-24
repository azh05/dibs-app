import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { InterestChip } from '@/components/interest-chip';
import { Segmented } from '@/components/segmented';
import { Text } from '@/components/text';
import { useDeals } from '@/lib/api';
import { DEFAULT_FILTERS, SORTS, SOURCES, applyFilters, type Filters } from '@/lib/filters';
import { plural } from '@/lib/format';
import { DEAL_TYPES, RADIUS_OPTIONS, STORE_SECTIONS, type InterestSection } from '@/lib/interests';
import { useStore } from '@/lib/store';
import { colors, gutter, radii } from '@/theme';

const TOGGLES: { key: 'openNow' | 'communityVerified' | 'hideExpired'; title: string; subtitle: string }[] = [
  { key: 'openNow', title: 'Open now', subtitle: 'Only stores open right now' },
  { key: 'communityVerified', title: 'Community verified', subtitle: 'Confirmed in store by dibs users' },
  { key: 'hideExpired', title: 'Hide likely expired', subtitle: 'Older posts with no end date' },
];

function toggled<T>(set: Set<T>, value: T) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

// 08 · Filters (Figma 39:1241): edits a draft; "Show N deals" applies it, Close throws it away.
export default function FiltersScreen() {
  const insets = useSafeAreaInsets();
  const { deals } = useDeals();
  const store = useStore();
  const [draft, setDraft] = useState<Filters>(store.filters);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const update = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }));
  const count = applyFilters(deals, draft).length;
  const allDealTypes = DEAL_TYPES.map((t) => t.label);
  const allDealTypesOn = allDealTypes.every((t) => draft.dealTypes.has(t));

  const toggleGroup = (section: InterestSection) => {
    if (section.adult && !store.adultUnlocked && store.unlockAdult() !== 'unlocked') {
      Alert.alert('21+ only', 'Add a birthday showing you’re 21 or older to see these stores.');
      return;
    }
    setOpenGroup((g) => (g === section.title ? null : section.title));
  };

  const apply = () => {
    store.setFilters(draft);
    router.back();
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <Icon name="close" size={22} />
        </Pressable>
        <Text weight="extrabold" size={18} tracking={-0.18}>
          Filters
        </Text>
        <Pressable onPress={() => setDraft(DEFAULT_FILTERS)} hitSlop={10} accessibilityRole="button">
          <Text weight="bold" size={14} color={colors.orange}>
            Reset
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Sort by">
          <Segmented
            options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
            value={draft.sort}
            onChange={(sort) => update({ sort })}
          />
        </Section>

        <Section title="Distance">
          <Segmented
            options={RADIUS_OPTIONS.map((mi) => ({ value: mi, label: `${mi} mi` }))}
            value={draft.radiusMi}
            onChange={(radiusMi) => update({ radiusMi })}
          />
        </Section>

        <Section
          title="Deal type"
          action={allDealTypesOn ? 'Clear' : 'Select all'}
          onAction={() => update({ dealTypes: new Set(allDealTypesOn ? [] : allDealTypes) })}>
          <View style={styles.chips}>
            {DEAL_TYPES.map((t) => (
              <InterestChip
                key={t.label}
                label={t.label}
                icon={t.icon}
                selected={draft.dealTypes.has(t.label)}
                onPress={() => update({ dealTypes: toggled(draft.dealTypes, t.label) })}
              />
            ))}
          </View>
        </Section>

        <Section title="Store type" action="Clear" onAction={() => update({ storeTypes: new Set() })}>
          <View style={styles.groups}>
            {STORE_SECTIONS.map((section, i) => {
              const picked = section.interests.filter((t) => draft.storeTypes.has(t.label)).length;
              const locked = section.adult && !store.adultUnlocked;
              const open = openGroup === section.title;
              return (
                <View key={section.title} style={i < STORE_SECTIONS.length - 1 && styles.groupDivider}>
                  <Pressable onPress={() => toggleGroup(section)} accessibilityRole="button" style={styles.groupRow}>
                    <View style={[styles.groupIcon, picked > 0 && { backgroundColor: colors.orangeSoft }]}>
                      <Icon name={section.icon} size={18} color={picked > 0 ? colors.orange : colors.ink} />
                    </View>
                    <Text weight="bold" size={15} style={{ flex: 1 }}>
                      {section.title}
                    </Text>
                    {locked ? (
                      <View style={styles.lock}>
                        <Icon name="lock" size={12} color={colors.inkTertiary} />
                        <Text weight="semibold" size={13} color={colors.inkTertiary}>
                          21+
                        </Text>
                      </View>
                    ) : (
                      <Text weight="semibold" size={13} color={picked > 0 ? colors.orange : colors.inkTertiary}>
                        {picked > 0 ? `${picked} of ${section.interests.length}` : 'None'}
                      </Text>
                    )}
                    <View style={open && { transform: [{ rotate: '90deg' }] }}>
                      <Icon name="chevron" size={18} color={colors.inkTertiary} />
                    </View>
                  </Pressable>
                  {open && (
                    <View style={[styles.chips, styles.groupChips]}>
                      {section.interests.map((t) => (
                        <InterestChip
                          key={t.label}
                          label={t.label}
                          icon={t.icon}
                          selected={draft.storeTypes.has(t.label)}
                          onPress={() => update({ storeTypes: toggled(draft.storeTypes, t.label) })}
                        />
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </Section>

        <Section title="Show">
          <View style={styles.toggles}>
            {TOGGLES.map((t, i) => (
              <View key={t.key} style={[styles.toggleRow, i < TOGGLES.length - 1 && styles.groupDivider]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight="bold" size={14}>
                    {t.title}
                  </Text>
                  <Text size={12} color={colors.inkTertiary}>
                    {t.subtitle}
                  </Text>
                </View>
                <Switch
                  value={draft[t.key]}
                  onValueChange={(on) => update({ [t.key]: on })}
                  trackColor={{ true: colors.orange, false: colors.border }}
                  ios_backgroundColor={colors.border}
                />
              </View>
            ))}
          </View>
        </Section>

        <Section title="Found on">
          <View style={styles.chips}>
            {SOURCES.map((s) => (
              <InterestChip
                key={s.kind}
                label={s.label}
                icon={s.icon}
                selected={draft.sources.has(s.kind)}
                onPress={() => update({ sources: toggled(draft.sources, s.kind) })}
              />
            ))}
          </View>
        </Section>
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <Button label={`Show ${plural(count, 'deal')}`} onPress={apply} style={{ flex: 1, paddingVertical: 17 }} />
      </View>
    </View>
  );
}

function Section({
  title,
  action,
  onAction,
  children,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.sectionHeader}>
        <Text weight="extrabold" size={16} tracking={-0.16}>
          {title}
        </Text>
        {action && (
          <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
            <Text weight="bold" size={13} color={colors.orange}>
              {action}
            </Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: gutter,
    paddingBottom: 10,
  },
  content: { gap: 26, paddingTop: 16, paddingHorizontal: gutter, paddingBottom: 32 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  groups: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, overflow: 'hidden' },
  groupDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  groupIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupChips: { paddingHorizontal: 14, paddingBottom: 14 },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toggles: { borderRadius: radii.card, backgroundColor: colors.muted, overflow: 'hidden' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  cta: {
    flexDirection: 'row',
    paddingTop: 14,
    paddingHorizontal: gutter,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
