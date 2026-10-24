// Map pin decluttering, in two passes: every pin first goes down as an icon, and one that would
// overlap an icon already placed folds into it (which then shows "+N"); then each placed pin grows
// to the most detail (compact, full) that still clears its neighbours. Zoomed-out maps keep as many
// pins visible as fit, and none stack on top of each other.
import { pinFootprint, type PinDetail } from '@/components/map-pin';
import type { LatLng } from '@/lib/types';

export type PinSpec = { id: string; coords: LatLng; label: string; store: string; time: string };
type Region = LatLng & { latitudeDelta: number; longitudeDelta: number };
type Rect = { left: number; right: number; top: number; bottom: number };

/** How a visible pin is drawn; `folded` lists the pins hidden under it. Pins left out are folded. */
export type PinPlacement = { detail: PinDetail; folded: string[] };

const DETAILS: PinDetail[] = ['full', 'compact', 'icon'];
/** Breathing room between neighbouring pins, in points. */
const MARGIN = 4;

function overlaps(a: Rect, b: Rect) {
  return (
    a.left < b.right + MARGIN && b.left < a.right + MARGIN && a.top < b.bottom + MARGIN && b.top < a.bottom + MARGIN
  );
}

/**
 * Pins earlier in `pins` win both passes, so pass the selected pin first. `maxDetail` caps every
 * pin (the zoom level's ceiling).
 */
export function layoutPins(pins: PinSpec[], region: Region, size: { width: number }, maxDetail: PinDetail) {
  // Points per degree. Apple Maps reports a latitudeDelta that doesn't match what's on screen, so
  // the vertical scale comes from the horizontal one: on a Mercator map, 1° of latitude spans
  // 1/cos(latitude) times as many points as 1° of longitude.
  const xScale = size.width / region.longitudeDelta;
  const yScale = xScale / Math.cos((region.latitude * Math.PI) / 180);
  const rectFor = (pin: PinSpec, detail: PinDetail): Rect => {
    const x = (pin.coords.longitude - region.longitude) * xScale;
    const y = (region.latitude - pin.coords.latitude) * yScale;
    const f = pinFootprint(detail, pin.label, pin.store, pin.time);
    return { left: x + f.left, right: x + f.right, top: y + f.top, bottom: y + f.bottom };
  };

  // Pass 1: icons only; a pin that can't fit folds into the first icon it hits.
  const placed: { pin: PinSpec; rect: Rect; placement: PinPlacement }[] = [];
  for (const pin of pins) {
    const rect = rectFor(pin, 'icon');
    const host = placed.find((p) => overlaps(p.rect, rect));
    if (host) host.placement.folded.push(pin.id);
    else placed.push({ pin, rect, placement: { detail: 'icon', folded: [] } });
  }

  // Pass 2: grow each pin as far as its neighbours (at their current size) allow.
  const allowed = DETAILS.slice(DETAILS.indexOf(maxDetail));
  for (const entry of placed) {
    const others = placed.filter((p) => p !== entry);
    const detail = allowed.find((d) => others.every((p) => !overlaps(p.rect, rectFor(entry.pin, d)))) ?? 'icon';
    entry.placement.detail = detail;
    entry.rect = rectFor(entry.pin, detail);
  }

  return new Map(placed.map((p) => [p.pin.id, p.placement]));
}
