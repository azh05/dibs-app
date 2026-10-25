import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Halo from '@/assets/shapes/halo.svg';
import You from '@/assets/shapes/you.svg';
import { DealCard } from '@/components/deal-card';
import { Icon } from '@/components/icon';
import { LineCheckCard } from '@/components/line-check-card';
import { MapPin, pinAnchor, pinCenterOffset, type PinDetail } from '@/components/map-pin';
import { SearchBar } from '@/components/search-bar';
import { Text } from '@/components/text';
import { useDeals } from '@/lib/api';
import { applyEventFilters, applyFilters, isOpenNow, SORTS, type Filters } from '@/lib/filters';
import { SOURCE_ICONS, eventRange, eventWeekday, expiryText, plural, recency, shortAgo } from '@/lib/format';
import { DEAL_TYPES } from '@/lib/interests';
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

// 08 · Map (Figma 4:298) and 12 · Line check (52:1759), laid out like Beli's list/map: a search bar
// and a row of filter chips on top, then either the full-screen map (a tapped pin shows its deal
// card) or a list of the same deals, swapped by the floating "View List" / "View Map" button.
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
  const featured = placed.find((d) => d.id === selectedId);
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
  const sort = SORTS.find((x) => x.key === filters.sort) ?? SORTS[0];
  const nextSort = SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length];
  const prompted = lineCheck.store;
  // A line-check prompt always shows on the map, over the list if that was open.
  const shownView = prompted ? 'map' : view;
  const list = shownView === 'list';

  // Zoom in on the store while asking about its line, so its geofence shows (Figma 11 · Line check).
  useEffect(() => {
    if (prompted?.coords) map.current?.animateToRegion(regionAtStore(prompted.coords), 400);
  }, [prompted]);

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
          const isSelected = d.id === selectedId;
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
          contentContainerStyle={{ paddingTop: topHeight, paddingBottom: 96 }}
          keyboardDismissMode="on-drag">
          <View style={styles.listHeader}>
            <Pressable
              onPress={() => store.setFilters({ ...filters, sort: nextSort.key })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Sorted by ${sort.sortedBy}. Sort by ${nextSort.sortedBy}`}
              style={styles.sort}>
              <Icon name="sliders" size={15} color={colors.orange} />
              <Text weight="bold" size={15} tracking={0.3} color={colors.orange}>
                {sort.label}
              </Text>
            </Pressable>
            <Text size={13} color={colors.inkTertiary}>
              {plural(shown.length, 'deal')} within {filters.radiusMi} mi
            </Text>
          </View>
          {shown.map((d) => (
            <DealRow
              key={d.id}
              deal={d}
              saved={saved.has(d.id)}
              onPress={() => router.push(`/deal/${d.id}`)}
              onToggleSaved={() => toggleSaved(d.id)}
            />
          ))}
          {shownEvents.map((e) => (
            <EventRow key={e.id} event={e} onPress={() => router.push(`/event/${e.id}`)} />
          ))}
          {shown.length === 0 && shownEvents.length === 0 && (
            <Text size={14} color={colors.inkTertiary} style={styles.empty}>
              No deals match these filters. Try a wider radius or fewer filters.
            </Text>
          )}
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
        <FilterChips filters={filters} onChange={store.setFilters} />
      </View>

      {list ? (
        <View style={styles.listToggle} pointerEvents="box-none">
          <ViewToggle view={shownView} onPress={() => setView('map')} />
        </View>
      ) : (
        <View
          style={styles.bottom}
          pointerEvents="box-none"
          onLayout={(e) => setBottomHeight(e.nativeEvent.layout.height)}>
          <Pressable
            onPress={() => map.current?.animateToRegion(regionAround(you), 400)}
            style={[styles.recenter, shadows.floating]}
            accessibilityRole="button"
            accessibilityLabel="Recenter map">
            <Icon name="navigation" size={20} color={colors.orange} />
          </Pressable>
          {!prompted && <ViewToggle view={shownView} onPress={() => setView('list')} />}
          {prompted ? (
            <View style={styles.card}>
              <LineCheckCard
                store={prompted.store}
                onReport={(minutes) => store.reportLine(prompted, minutes, position)}
                onUndo={store.undoLineReport}
                onClose={lineCheck.dismiss}
              />
            </View>
          ) : (
            featured && (
              <View style={styles.card}>
                <DealCard
                  deal={featured}
                  line={combinedLine(featured, lineReports)}
                  saved={saved.has(featured.id)}
                  onPress={() => router.push(`/deal/${featured.id}`)}
                  onToggleSaved={() => toggleSaved(featured.id)}
                />
              </View>
            )
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Beli's chip row: a filters button, then one-tap toggles for Open now, Verified and each deal type,
 * plus any store types picked on the Filters screen. On chips show a × and turn orange.
 */
function FilterChips({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const toggled = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };
  const chips = [
    ...[...filters.storeTypes].map((t) => ({
      key: `store:${t}`,
      label: t,
      on: true,
      toggle: () => onChange({ ...filters, storeTypes: toggled(filters.storeTypes, t) }),
    })),
    {
      key: 'open',
      label: 'Open now',
      on: filters.openNow,
      toggle: () => onChange({ ...filters, openNow: !filters.openNow }),
    },
    {
      key: 'verified',
      label: 'Verified',
      on: filters.communityVerified,
      toggle: () => onChange({ ...filters, communityVerified: !filters.communityVerified }),
    },
    ...DEAL_TYPES.map((t) => ({
      key: `deal:${t.label}`,
      label: t.label,
      on: filters.dealTypes.has(t.label),
      toggle: () => onChange({ ...filters, dealTypes: toggled(filters.dealTypes, t.label) }),
    })),
  ];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chips}
      contentContainerStyle={styles.chipsContent}>
      <Pressable
        onPress={() => router.push('/filters')}
        accessibilityRole="button"
        accessibilityLabel="All filters"
        style={[styles.chip, styles.chipIcon]}>
        <Icon name="sliders" size={18} color={colors.orange} />
      </Pressable>
      {chips.map((c) => (
        <Pressable
          key={c.key}
          onPress={c.toggle}
          accessibilityRole="button"
          accessibilityState={{ selected: c.on }}
          style={({ pressed }) => [styles.chip, c.on && styles.chipOn, pressed && { opacity: 0.7 }]}>
          <Text weight="semibold" size={15}>
            {c.label}
          </Text>
          {c.on && <Icon name="close" size={14} color={colors.orange} />}
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** Beli's list row: name, what and where on the left; the deal in a ring and a bookmark on the right. */
function ListRow({
  title,
  subtitle,
  address,
  meta,
  badge,
  count,
  onPress,
  trailing,
}: {
  title: string;
  subtitle: string;
  address: string | null;
  meta: string;
  badge: string;
  count?: number;
  onPress: () => void;
  trailing?: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.muted }]}>
      <View style={styles.rowMain}>
        <View style={styles.rowText}>
          <Text weight="extrabold" size={19} tracking={-0.3} numberOfLines={1}>
            {title}
          </Text>
          <Text size={15} color={colors.inkSecondary} numberOfLines={1}>
            {subtitle}
          </Text>
          {address && (
            <View style={styles.rowAddress}>
              <Icon name="pin" size={14} color={colors.inkSecondary} />
              <Text size={15} color={colors.inkSecondary} numberOfLines={1} style={{ flex: 1 }}>
                {address}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.ring}>
          <Text
            weight="extrabold"
            size={13}
            color={colors.orange}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}>
            {badge}
          </Text>
          {!!count && (
            <View style={styles.ringCount}>
              <Text weight="bold" size={10} color={colors.surface}>
                {count}
              </Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.rowFooter}>
        <Text size={14} color={colors.inkTertiary} numberOfLines={1} style={{ flex: 1 }}>
          {meta}
        </Text>
        {trailing}
      </View>
    </Pressable>
  );
}

function DealRow({
  deal,
  saved,
  onPress,
  onToggleSaved,
}: {
  deal: Deal;
  saved: boolean;
  onPress: () => void;
  onToggleSaved: () => void;
}) {
  const open = deal.hours ? (isOpenNow(deal) ? 'Open' : 'Closed') : null;
  const meta = [
    deal.distanceMi != null ? `${deal.distanceMi} mi` : null,
    open,
    open === 'Open' && deal.openUntil ? `Closes ${deal.openUntil}` : null,
    expiryText(deal),
  ];
  return (
    <ListRow
      title={deal.store}
      subtitle={`${deal.typeLabel} · ${deal.shortOffer}`}
      address={deal.address}
      meta={meta.filter(Boolean).join(' · ')}
      badge={deal.pinLabel}
      count={deal.confirmations}
      onPress={onPress}
      trailing={
        <Pressable
          onPress={onToggleSaved}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={saved ? 'Remove bookmark' : 'Bookmark deal'}>
          <Icon name="bookmark" size={24} color={saved ? colors.orange : colors.ink} />
        </Pressable>
      }
    />
  );
}

function EventRow({ event, onPress }: { event: DealEvent; onPress: () => void }) {
  return (
    <ListRow
      title={event.title}
      subtitle={`${event.store} · ${event.area}`}
      address={null}
      meta={`${event.distanceMi} mi · ${eventRange(event)}`}
      badge={event.pinLabel}
      onPress={onPress}
      trailing={<Icon name="calendar" size={22} color={colors.orange} />}
    />
  );
}

/** The floating dark pill that swaps the map and the list. */
function ViewToggle({ view, onPress }: { view: 'map' | 'list'; onPress: () => void }) {
  const toList = view === 'map';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.toggleView, shadows.post, pressed && { opacity: 0.85 }]}>
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
        <Icon name="map" size={18} color={colors.surface} />
      )}
      <Text weight="bold" size={15} color={colors.surface}>
        {toList ? 'View List' : 'View Map'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F2F0EB' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: gutter, gap: 12 },
  topSolid: {
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  you: { width: 70, height: 70 },
  youDot: { position: 'absolute', left: 20, top: 22 },
  chips: { marginHorizontal: -gutter },
  chipsContent: { gap: 8, paddingHorizontal: gutter },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  chipIcon: { paddingHorizontal: 14 },
  chipOn: { borderColor: colors.orange, backgroundColor: colors.orangeSoft },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'flex-end',
    gap: 12,
    paddingBottom: 16,
  },
  recenter: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: gutter,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { alignSelf: 'stretch', paddingHorizontal: gutter },
  list: { ...StyleSheet.absoluteFill, backgroundColor: colors.surface },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: gutter,
    paddingVertical: 14,
  },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: {
    gap: 18,
    paddingHorizontal: gutter,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowMain: { flexDirection: 'row', gap: 16 },
  rowText: { flex: 1, gap: 3 },
  rowAddress: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowFooter: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ring: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  ringCount: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    minWidth: 26,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.surface,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { textAlign: 'center', paddingTop: 40, paddingHorizontal: gutter },
  listToggle: { position: 'absolute', right: 0, bottom: 16 },
  toggleView: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginRight: gutter,
    paddingHorizontal: 24,
    height: 52,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
  },
  listGlyph: { gap: 3 },
  listGlyphRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  listGlyphDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.surface },
  listGlyphLine: { width: 11, height: 2, borderRadius: 1, backgroundColor: colors.surface },
});
