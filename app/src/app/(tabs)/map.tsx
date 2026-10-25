import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Halo from '@/assets/shapes/halo.svg';
import You from '@/assets/shapes/you.svg';
import { DealCard } from '@/components/deal-card';
import { EventCard } from '@/components/event-card';
import { Icon } from '@/components/icon';
import { LineCheckCard } from '@/components/line-check-card';
import { MapPin, pinAnchor, pinCenterOffset, type PinDetail } from '@/components/map-pin';
import { SearchBar } from '@/components/search-bar';
import { Text } from '@/components/text';
import { useDeals } from '@/lib/api';
import { appliedFilters, applyEventFilters, applyFilters, SORTS } from '@/lib/filters';
import { SOURCE_ICONS, eventWeekday, plural, recency, shortAgo } from '@/lib/format';
import { combinedLine, GEOFENCE_METERS, useLineCheck, useUserLocation } from '@/lib/line-check';
import { layoutPins } from '@/lib/pin-layout';
import { useStore } from '@/lib/store';
import type { Deal, DealEvent, LatLng } from '@/lib/types';
import { colors, gutter, radii, shadows } from '@/theme';

/** About a mile of Westwood around a point, the zoom the Figma map is drawn at. */
function regionAround(center: LatLng) {
  return { ...center, latitudeDelta: 0.035, longitudeDelta: 0.02 };
}

/** Close enough to see a store's geofence while asking about its line. */
function regionAtStore(center: LatLng) {
  return { ...center, latitudeDelta: 0.006, longitudeDelta: 0.0035 };
}

/** Pins show less as the map zooms out (by visible latitude span) so they stop piling up. */
function detailFor(latitudeDelta: number): PinDetail {
  if (latitudeDelta <= 0.045) return 'full';
  if (latitudeDelta <= 0.06) return 'compact';
  return 'icon';
}

// 08 · Map (Figma 4:298) and 12 · Line check (52:1759). The map fills the screen; tapping a pin
// shows that deal's card at the bottom. A floating "View List" / "View Map" pill (after Beli)
// swaps the map for a list of the same deals, under a header ("Edit" opens Filters) and filter chips.
export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const { deals, events } = useDeals();
  const store = useStore();
  const { saved, toggleSaved, filters, lineReports, place } = store;
  const home = place.coords;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [topHeight, setTopHeight] = useState(0);
  const [bottomHeight, setBottomHeight] = useState(0);
  const [region, setRegion] = useState(regionAround(home));
  const [mapWidth, setMapWidth] = useState(0);
  const position = useUserLocation();
  const you = position ?? home;
  const lineCheck = useLineCheck(deals, position);

  const shown = applyFilters(deals, filters, query, store.topics);
  const placed = shown.filter((d) => d.coords);
  const shownEvents = applyEventFilters(events, filters, query);
  const selected = placed.find((d) => d.id === selectedId);
  const eventTime = (e: DealEvent) => eventWeekday(e).charAt(0) + eventWeekday(e).slice(1).toLowerCase();

  // Each pin gets the most detail that fits without overlapping; the tapped deal is laid out first.
  const pinSpecs = [
    ...placed.map((d) => ({
      id: d.id,
      coords: d.coords!,
      label: d.pinLabel,
      store: d.store,
      time: shortAgo(d.postedHoursAgo),
    })),
    ...shownEvents.map((e) => ({ id: e.id, coords: e.coords, label: e.pinLabel, store: e.store, time: eventTime(e) })),
  ].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId));
  const placements = layoutPins(pinSpecs, region, { width: mapWidth }, detailFor(region.latitudeDelta));

  /** Taps on a pin with others folded under it zoom in until they separate. */
  const expandCluster = (id: string) => {
    const ids = [id, ...(placements.get(id)?.folded ?? [])];
    const coords = pinSpecs.filter((p) => ids.includes(p.id)).map((p) => p.coords);
    map.current?.fitToCoordinates(coords, {
      edgePadding: { top: topHeight + 80, bottom: bottomHeight + 60, left: 80, right: 80 },
      animated: true,
    });
  };
  const applied = appliedFilters(filters);
  const sortedBy = SORTS.find((s) => s.key === filters.sort)?.sortedBy ?? 'distance';
  const prompted = lineCheck.store;
  // A line-check prompt always shows on the map, over the list if that was open.
  const list = !prompted && view === 'list';

  // Zoom in on the store while asking about its line, so its geofence shows (Figma 11 · Line check).
  useEffect(() => {
    if (prompted?.coords) map.current?.animateToRegion(regionAtStore(prompted.coords), 400);
  }, [prompted]);

  const card = (d: Deal) => (
    <DealCard
      key={d.id}
      deal={d}
      line={combinedLine(d, lineReports)}
      saved={saved.has(d.id)}
      onPress={() => router.push(`/deal/${d.id}`)}
      onToggleSaved={() => toggleSaved(d.id)}
    />
  );

  const sheetTop = (
    <>
      <SheetHeader
        count={shown.length}
        radiusMi={filters.radiusMi}
        sortedBy={sortedBy}
        onEdit={() => router.push('/filters')}
      />
      {applied.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.applied}>
          {applied.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => store.setFilters(f.remove(filters))}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${f.label}`}
              style={styles.appliedChip}>
              <Text weight="bold" size={12}>
                {f.label}
              </Text>
              <Icon name="close" size={10} color={colors.orange} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </>
  );

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        onLayout={(e) => setMapWidth(e.nativeEvent.layout.width)}
        mapType="mutedStandard"
        userInterfaceStyle="light"
        showsPointsOfInterests={false}
        showsCompass={false}
        rotateEnabled={false}
        pitchEnabled={false}
        initialRegion={regionAround(home)}
        // Keeps the visible middle of the map between the search bar and the bottom sheet.
        mapPadding={{ top: topHeight, bottom: bottomHeight, left: 0, right: 0 }}
        onMapReady={() => map.current?.animateToRegion(regionAround(you), 0)}
        onRegionChangeComplete={setRegion}
        onPress={(e) => {
          // Tapping empty map clears the selection; marker taps also reach here on iOS.
          if (e.nativeEvent.action !== 'marker-press') setSelectedId(null);
        }}>
        {prompted?.coords && (
          <Circle
            center={prompted.coords}
            radius={prompted.geofenceM ?? GEOFENCE_METERS}
            strokeColor={colors.orange}
            strokeWidth={1.5}
            lineDashPattern={[6, 5]}
            fillColor="rgba(255,90,31,0.08)"
          />
        )}
        <Marker coordinate={you} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={styles.you} accessibilityLabel="You are here">
            <Halo width={70} height={70} />
            <View style={styles.youDot}>
              <You width={30} height={30} />
            </View>
          </View>
        </Marker>
        {placed.map((d) => {
          const placement = placements.get(d.id);
          if (!placement) return null;
          // The store a line check is asking about shows as selected (Figma 12 · Line check).
          const isSelected = d.id === selectedId || d.id === prompted?.id;
          const folded = placement.folded.length;
          return (
            <Marker
              key={d.id}
              coordinate={d.coords!}
              anchor={pinAnchor}
              centerOffset={pinCenterOffset}
              zIndex={isSelected ? 10 : 1}
              onPress={() => (folded > 0 && !isSelected ? expandCluster(d.id) : setSelectedId(d.id))}>
              <MapPin
                state={isSelected ? 'selected' : recency(d.postedHoursAgo)}
                detail={isSelected ? 'full' : placement.detail}
                label={d.pinLabel}
                store={d.store}
                icon={d.icon}
                sourceIcon={SOURCE_ICONS[d.source.kind]}
                time={shortAgo(d.postedHoursAgo)}
                folded={folded}
              />
            </Marker>
          );
        })}
        {shownEvents.map((e) => {
          const placement = placements.get(e.id);
          if (!placement) return null;
          const folded = placement.folded.length;
          return (
            <Marker
              key={e.id}
              coordinate={e.coords}
              anchor={pinAnchor}
              centerOffset={pinCenterOffset}
              onPress={() => (folded > 0 ? expandCluster(e.id) : router.push(`/event/${e.id}`))}>
              <MapPin
                state="upcoming"
                detail={placement.detail}
                folded={folded}
                label={e.pinLabel}
                store={e.store}
                icon={e.icon}
                sourceIcon="instagram"
                time={eventTime(e)}
              />
            </Marker>
          );
        })}
      </MapView>

      {list && (
        <ScrollView
          style={styles.list}
          contentContainerStyle={[styles.listContent, { paddingTop: topHeight + 8 }]}
          keyboardDismissMode="on-drag">
          {sheetTop}
          {shown.map(card)}
          {shownEvents.map((e) => (
            <EventCard key={e.id} event={e} onPress={() => router.push(`/event/${e.id}`)} />
          ))}
        </ScrollView>
      )}

      <View
        style={[styles.top, list && styles.topSolid, { paddingTop: insets.top + 4 }]}
        pointerEvents="box-none"
        onLayout={(e) => setTopHeight(e.nativeEvent.layout.height)}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search this area"
          onFilters={() => router.push('/filters')}
          floating={!list}
        />
      </View>

      {list ? (
        <View style={styles.listToggle} pointerEvents="box-none">
          <ViewToggle toList={false} onPress={() => setView('map')} />
        </View>
      ) : (
        <View
          style={[styles.bottom, !prompted && !selected && styles.bottomBare]}
          pointerEvents="box-none"
          onLayout={(e) => setBottomHeight(e.nativeEvent.layout.height)}>
          <View style={styles.controls} pointerEvents="box-none">
            {!prompted && <ViewToggle toList onPress={() => setView('list')} />}
            <Pressable
              onPress={() => map.current?.animateToRegion(regionAround(you), 400)}
              style={styles.recenter}
              accessibilityRole="button"
              accessibilityLabel="Recenter map">
              <Icon name="navigation" size={20} color={colors.orange} />
            </Pressable>
          </View>
          {prompted ? (
            <View style={styles.bottomCard}>
              <LineCheckCard
                store={prompted.store}
                onReport={(minutes) => store.reportLine(prompted, minutes, position)}
                onUndo={store.undoLineReport}
                onClose={lineCheck.dismiss}
              />
            </View>
          ) : (
            selected && <View style={[styles.bottomCard, shadows.floating]}>{card(selected)}</View>
          )}
        </View>
      )}
    </View>
  );
}

/** The floating ink pill that swaps the map and the list. */
function ViewToggle({ toList, onPress }: { toList: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.viewToggle, shadows.floating, pressed && { opacity: 0.85 }]}>
      {toList ? (
        <View style={styles.listGlyph}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.listGlyphRow}>
              <View style={styles.listGlyphDot} />
              <View style={styles.listGlyphLine} />
            </View>
          ))}
        </View>
      ) : (
        <Icon name="map" size={16} color={colors.surface} />
      )}
      <Text weight="bold" size={14} color={colors.surface}>
        {toList ? 'View List' : 'View Map'}
      </Text>
    </Pressable>
  );
}

function SheetHeader({
  count,
  radiusMi,
  sortedBy,
  onEdit,
}: {
  count: number;
  radiusMi: number;
  sortedBy: string;
  onEdit: () => void;
}) {
  return (
    <View style={styles.sheetHeader}>
      <View style={{ gap: 2 }}>
        <Text weight="extrabold" size={17} tracking={-0.17}>
          {plural(count, 'deal')} within {radiusMi} mi
        </Text>
        <Text size={13} color={colors.inkTertiary}>
          Sorted by {sortedBy}
        </Text>
      </View>
      <Pressable onPress={onEdit} accessibilityRole="button" style={styles.toggle}>
        <Icon name="sliders" size={14} />
        <Text weight="bold" size={13}>
          Edit
        </Text>
      </Pressable>
    </View>
  );
}

/** Gap between the View Map / View List pill and the tab bar, the same on the map and the list. */
const TOGGLE_BOTTOM = 14;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F2F0EB' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: gutter },
  you: { width: 70, height: 70 },
  youDot: { position: 'absolute', left: 20, top: 22 },
  topSolid: {
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: 12 },
  // With no card under it, lift the controls so View List sits where View Map does on the list (TOGGLE_BOTTOM).
  bottomBare: { paddingBottom: TOGGLE_BOTTOM - 2 },
  // View List centred, the recenter button on the right edge as in Figma.
  controls: { height: 48, alignItems: 'center', justifyContent: 'center' },
  recenter: {
    position: 'absolute',
    right: gutter,
    width: 48,
    height: 48,
    borderRadius: 24,
    // Figma: 0 4 14 rgba(23,23,26,0.12).
    shadowColor: '#17171A',
    shadowOpacity: 0.12,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomCard: { alignSelf: 'stretch', paddingHorizontal: gutter, paddingBottom: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.muted,
  },
  applied: { gap: 6 },
  list: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.surface },
  listContent: { gap: 14, paddingHorizontal: gutter, paddingBottom: 96 },
  listToggle: { position: 'absolute', left: 0, right: 0, bottom: TOGGLE_BOTTOM, alignItems: 'center' },
  viewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
  },
  listGlyph: { gap: 3 },
  listGlyphRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  listGlyphDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.surface },
  listGlyphLine: { width: 10, height: 2, borderRadius: 1, backgroundColor: colors.surface },
  appliedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.orange,
    backgroundColor: colors.orangeSoft,
  },
});
