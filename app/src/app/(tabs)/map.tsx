import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Halo from '@/assets/shapes/halo.svg';
import LegendDay from '@/assets/shapes/legend-day.svg';
import LegendNew from '@/assets/shapes/legend-new.svg';
import LegendWeek from '@/assets/shapes/legend-week.svg';
import You from '@/assets/shapes/you.svg';
import { Chip } from '@/components/chip';
import { DealCard } from '@/components/deal-card';
import { EventCard } from '@/components/event-card';
import { Icon } from '@/components/icon';
import { MapPin, pinAnchor, pinCenterOffset, type PinDetail } from '@/components/map-pin';
import { SearchBar } from '@/components/search-bar';
import { Overline } from '@/components/section-header';
import { Text } from '@/components/text';
import { useDeals } from '@/lib/api';
import { FILTERS, filterDeals, filterEvents, type Filter } from '@/lib/filters';
import { SOURCE_ICONS, eventWeekday, recency, shortAgo } from '@/lib/format';
import { HOME } from '@/lib/mock';
import { useStore } from '@/lib/store';
import { colors, gutter, radii, shadows } from '@/theme';

/** About a mile of Westwood around "You", the zoom the Figma map is drawn at. */
const NEIGHBORHOOD = {
  latitude: HOME.latitude,
  longitude: HOME.longitude,
  latitudeDelta: 0.035,
  longitudeDelta: 0.02,
};

/** Pins show less as the map zooms out (by visible latitude span) so they stop piling up. */
function detailFor(latitudeDelta: number): PinDetail {
  if (latitudeDelta <= 0.045) return 'full';
  if (latitudeDelta <= 0.06) return 'compact';
  return 'icon';
}

const legendUpcoming = require('@/assets/shapes/legend-upcoming.png');

const LEGEND = [
  { label: 'New', Dot: LegendNew },
  { label: '1d', Dot: LegendDay },
  { label: '1w+', Dot: LegendWeek },
] as const;

// 03 · Map (Figma 4:298). The map fills the screen; "View list" swaps it for the same deals as a list.
export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const { deals, events } = useDeals();
  const { saved, toggleSaved, radiusMi } = useStore();
  const [filter, setFilter] = useState<Filter>('All');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'map' | 'list'>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [topHeight, setTopHeight] = useState(0);
  const [detail, setDetail] = useState<PinDetail>(detailFor(NEIGHBORHOOD.latitudeDelta));

  const shown = filterDeals(deals, filter, query).sort((a, b) => (a.distanceMi ?? 99) - (b.distanceMi ?? 99));
  const placed = shown.filter((d) => d.coords);
  const shownEvents = filterEvents(events, filter, query);
  const nearby = shown.filter((d) => (d.distanceMi ?? 99) <= radiusMi);
  const selected = placed.find((d) => d.id === selectedId);
  const onMap = view === 'map';

  const recenter = () => map.current?.animateToRegion(NEIGHBORHOOD, 400);

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        mapType="mutedStandard"
        userInterfaceStyle="light"
        showsPointsOfInterests={false}
        showsCompass={false}
        zoomEnabled
        scrollEnabled
        rotateEnabled={false}
        pitchEnabled={false}
        initialRegion={NEIGHBORHOOD}
        onRegionChangeComplete={(region) => setDetail(detailFor(region.latitudeDelta))}
        onPress={(e) => {
          // Tapping empty map clears the selection; marker taps also reach here on iOS.
          if (e.nativeEvent.action !== 'marker-press') setSelectedId(null);
        }}>
        <Marker coordinate={HOME} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={styles.you} accessibilityLabel="You are here">
            <Halo width={70} height={70} />
            <View style={styles.youDot}>
              <You width={30} height={30} />
            </View>
          </View>
        </Marker>
        {placed.map((d) => {
          const isSelected = d.id === selectedId;
          const pinDetail = isSelected ? 'full' : detail;
          return (
            <Marker
              key={d.id}
              coordinate={d.coords!}
              anchor={pinAnchor}
              centerOffset={pinCenterOffset}
              zIndex={isSelected ? 10 : 1}
              onPress={() => setSelectedId(d.id)}>
              <MapPin
                state={isSelected ? 'selected' : recency(d.postedHoursAgo)}
                detail={pinDetail}
                label={d.pinLabel}
                store={d.store}
                icon={d.icon}
                sourceIcon={SOURCE_ICONS[d.source.kind]}
                time={shortAgo(d.postedHoursAgo)}
              />
            </Marker>
          );
        })}
        {shownEvents.map((e) => (
          <Marker
            key={e.id}
            coordinate={e.coords}
            anchor={pinAnchor}
            centerOffset={pinCenterOffset}
            onPress={() => router.push(`/event/${e.id}`)}>
            <MapPin
              state="upcoming"
              detail={detail}
              label={e.pinLabel}
              store={e.store}
              icon={e.icon}
              sourceIcon="instagram"
              time={eventWeekday(e).charAt(0) + eventWeekday(e).slice(1).toLowerCase()}
            />
          </Marker>
        ))}
      </MapView>

      {!onMap && (
        <ScrollView
          style={styles.list}
          contentContainerStyle={[styles.listContent, { paddingTop: topHeight + 8 }]}
          keyboardShouldPersistTaps="handled">
          <View style={{ gap: 2 }}>
            <Text weight="extrabold" size={17} tracking={-0.17}>
              {nearby.length} deals within {radiusMi} mi
            </Text>
            <Text size={13} color={colors.inkTertiary}>
              Sorted by distance
            </Text>
          </View>
          {shown.map((d) => (
            <DealCard
              key={d.id}
              deal={d}
              saved={saved.has(d.id)}
              onPress={() => router.push(`/deal/${d.id}`)}
              onToggleSaved={() => toggleSaved(d.id)}
            />
          ))}
          {shownEvents.length > 0 && (
            <View style={{ gap: 12, paddingTop: 8 }}>
              <Overline>COMING UP</Overline>
              {shownEvents.map((e) => (
                <EventCard key={e.id} event={e} onPress={() => router.push(`/event/${e.id}`)} />
              ))}
            </View>
          )}
          {shown.length === 0 && shownEvents.length === 0 && (
            <Text size={14} color={colors.inkTertiary}>
              Nothing here yet. Try another filter.
            </Text>
          )}
        </ScrollView>
      )}

      <View
        style={[styles.top, { paddingTop: insets.top + 4 }]}
        pointerEvents="box-none"
        onLayout={(e) => setTopHeight(e.nativeEvent.layout.height)}>
        <View style={styles.pad}>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            placeholder={onMap ? 'Search this area' : 'Search stores or deals'}
            floating={onMap}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipsScroll}>
          {FILTERS.map((f) => (
            <Chip key={f} label={f} active={f === filter} onPress={() => setFilter(f)} floating={onMap} />
          ))}
        </ScrollView>
        {onMap && (
          <View style={[styles.pad, { alignItems: 'flex-start' }]} pointerEvents="none">
            <View style={styles.legend}>
              {LEGEND.map(({ label, Dot }) => (
                <View key={label} style={styles.legendItem}>
                  <Dot width={7} height={7} />
                  <Text weight="semibold" size={11} color={colors.inkSecondary}>
                    {label}
                  </Text>
                </View>
              ))}
              <View style={styles.legendItem}>
                <Image source={legendUpcoming} style={{ width: 7, height: 7 }} />
                <Text weight="semibold" size={11} color={colors.inkSecondary}>
                  Upcoming
                </Text>
              </View>
            </View>
          </View>
        )}
      </View>

      <View style={styles.bottom} pointerEvents="box-none">
        {onMap && (
          <Pressable
            onPress={recenter}
            style={[styles.recenter, shadows.floating]}
            accessibilityRole="button"
            accessibilityLabel="Recenter map">
            <Icon name="navigation" size={20} color={colors.orange} />
          </Pressable>
        )}
        <Pressable
          onPress={() => {
            setSelectedId(null);
            setView(onMap ? 'list' : 'map');
          }}
          style={({ pressed }) => [styles.toggle, shadows.floating, pressed && { opacity: 0.85 }]}
          accessibilityRole="button">
          <Icon name={onMap ? 'tag' : 'map'} size={18} color={colors.surface} />
          <Text weight="bold" size={15} color={colors.surface}>
            {onMap ? 'View list' : 'View map'}
          </Text>
        </Pressable>
        {onMap && selected && (
          <View style={styles.selected}>
            <DealCard
              deal={selected}
              saved={saved.has(selected.id)}
              onPress={() => router.push(`/deal/${selected.id}`)}
              onToggleSaved={() => toggleSaved(selected.id)}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F2F0EB' },
  pad: { paddingHorizontal: gutter },
  top: { position: 'absolute', left: 0, right: 0, top: 0, gap: 12 },
  chipsScroll: { flexGrow: 0, overflow: 'visible' },
  chips: { gap: 8, paddingHorizontal: gutter, paddingVertical: 2 },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  you: { width: 70, height: 70 },
  youDot: { position: 'absolute', left: 20, top: 22 },
  list: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.surface },
  // Bottom padding leaves room to scroll the last card above the floating toggle.
  listContent: { paddingHorizontal: gutter, paddingBottom: 96, gap: 12 },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'flex-end',
    paddingHorizontal: gutter,
    paddingBottom: 16,
    gap: 12,
  },
  recenter: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
  },
  selected: { alignSelf: 'stretch', borderRadius: radii.card, ...shadows.floating },
});
