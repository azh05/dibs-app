// A user's photo of an in-store deal → what the result screen shows. In backend mode the photo is uploaded to
// Convex storage and photos.submit hands it to the API (/extract/photo); the screen subscribes to the submission.
// Without the backend, the check posts to the API directly when EXPO_PUBLIC_API_URL is set, and otherwise returns
// the Figma example (an expired Chipotle poster).
// The wording follows the API's own demo page (api/demo/index.html).
import { useMutation } from 'convex/react';
import * as ImagePicker from 'expo-image-picker';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { API_URL, apiHeaders } from '@/lib/api';
import type { ApiDeal, ApiSearchResponse } from '@/lib/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type Photo = { uri: string; mimeType: string; date: string };

function localISO(d = new Date()) {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

/** "2026:07:06 15:02:11" from EXIF, as YYYY-MM-DD; the API infers missing years from it. */
function exifDate(exif: Record<string, unknown> | null | undefined) {
  const nested = exif?.['{Exif}'] as Record<string, unknown> | undefined;
  const raw = nested?.DateTimeOriginal ?? exif?.DateTimeOriginal;
  const m = typeof raw === 'string' ? raw.match(/^(\d{4}):(\d{2}):(\d{2})/) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Asks "Take photo / Choose from library"; null when cancelled. */
function chooseSource(): Promise<'camera' | 'library' | null> {
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Take photo', 'Choose from library', 'Cancel'], cancelButtonIndex: 2 },
        (i) => resolve(i === 0 ? 'camera' : i === 1 ? 'library' : null),
      );
      return;
    }
    Alert.alert(
      'Add a photo',
      undefined,
      [
        { text: 'Take photo', onPress: () => resolve('camera') },
        { text: 'Choose from library', onPress: () => resolve('library') },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

/** The camera or the library, as the user picks; "Take photo" falls back to the library when there is no
 * camera (simulator) or camera access is denied. */
export async function pickPhoto(): Promise<Photo | null> {
  const source = await chooseSource();
  if (!source) return null;
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, exif: true };
  let result: ImagePicker.ImagePickerResult | null = null;
  if (source === 'camera' && (await ImagePicker.requestCameraPermissionsAsync()).granted) {
    try {
      result = await ImagePicker.launchCameraAsync(options);
    } catch {
      // No camera available.
    }
  }
  result ??= await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg', date: exifDate(asset.exif) ?? localISO() };
}

function mockResponse(photoDate: string): ApiSearchResponse {
  // "July 6th" without a year: the API picks the July 6 nearest the photo date, here the one just past.
  const taken = new Date(`${photoDate}T12:00:00`);
  const year = taken >= new Date(taken.getFullYear(), 6, 6) ? taken.getFullYear() : taken.getFullYear() - 1;
  const day = `${year}-07-06`;
  return {
    as_of: localISO(),
    deals: [
      {
        shop_name: 'Chipotle',
        shop_handle: null,
        address: null,
        category: 'food',
        offer: 'Free BOGO entrée',
        code: null,
        conditions: ['Limit 2 per customer', 'In-restaurant only', 'extra cost for some items', 'until close'],
        start_date: day,
        end_date: day,
        start_time: '15:00:00',
        end_time: null,
        source_url: 'https://dibs.local/photo/mock',
        source_post_date: photoDate,
        verbatim_quote: 'Come into Chipotle on July 6th from 3PM to close',
        confidence: 'high',
        status: 'expired',
        flags: ['year_inferred'],
      },
    ],
    rejected: [],
    search_errors: [],
    transcript: null,
  };
}

/** Without the backend: read the deal off a photo through the API (5 to 20 s), or the Figma example. */
export async function checkPhoto(photo: Photo): Promise<ApiSearchResponse> {
  if (!API_URL) {
    await new Promise((r) => setTimeout(r, 1500));
    return mockResponse(photo.date);
  }
  const form = new FormData();
  const ext = photo.mimeType.split('/')[1] ?? 'jpg';
  // React Native's FormData takes a { uri, name, type } file part.
  form.append('image', { uri: photo.uri, name: `photo.${ext}`, type: photo.mimeType } as unknown as Blob);
  form.append('photo_date', photo.date);
  form.append('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles');
  const res = await fetch(`${API_URL}/extract/photo`, { method: 'POST', body: form, headers: apiHeaders(false) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${res.status})`);
  return body as ApiSearchResponse;
}

/** Backend mode: upload the photo to Convex storage and submit it. Returns the submission to watch. */
export function useSubmitPhoto() {
  const generateUploadUrl = useMutation(api.photos.generateUploadUrl);
  const submit = useMutation(api.photos.submit);
  return async (photo: Photo): Promise<Id<'photo_submissions'>> => {
    const uploadUrl = await generateUploadUrl({});
    const blob = await (await fetch(photo.uri)).blob();
    const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': photo.mimeType }, body: blob });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    const { storageId } = (await res.json()) as { storageId: Id<'_storage'> };
    return submit({
      storageId,
      photo_date: photo.date,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
    });
  };
}

const REJECT_TEXT: Record<string, string> = {
  quote_not_in_source: 'the text we quoted isn’t on the poster',
  missing_quote: 'there was no quote from the poster to back it up',
  source_not_in_search_results: 'it didn’t come from your photo',
};

/** Why no deal came back: nothing on the poster, or a deal that failed verification. */
export function noDealReason(res: ApiSearchResponse) {
  const reason = res.rejected?.[0]?.reason;
  if (!reason) return 'We couldn’t find an offer in this photo. Try a closer, straighter shot.';
  return `We read a deal, but ${REJECT_TEXT[reason] ?? reason}.`;
}

/** dibs credits for the first verified photo of a new, live deal. */
export const CREDITS_PER_DEAL = 500;

export function isEligible(deal: ApiDeal) {
  return deal.status === 'live' && !deal.flags.includes('low_confidence');
}

function fmtDate(iso: string) {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function fmtTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const UNTIL_CLOSE = /until close/i;

/** "Jul 6 · 3:00 PM – close" */
export function whenText(deal: ApiDeal) {
  const { start_date: s, end_date: e, start_time: st, end_time: et } = deal;
  const untilClose = deal.conditions.some((c) => UNTIL_CLOSE.test(c));
  let days = '';
  if (s && e && s === e) days = fmtDate(s);
  else if (s && e) days = `${fmtDate(s)} – ${fmtDate(e)}`;
  else if (e) days = `Until ${fmtDate(e)}`;
  else if (s) days = `From ${fmtDate(s)}`;
  let hours = '';
  if (st && et) hours = `${fmtTime(st)} – ${fmtTime(et)}`;
  else if (st) hours = untilClose ? `${fmtTime(st)} – close` : `from ${fmtTime(st)}`;
  else if (et) hours = `until ${fmtTime(et)}`;
  return [days, hours].filter(Boolean).join(' · ') || 'No dates on the poster';
}

export function whenNote(deal: ApiDeal) {
  if (deal.flags.includes('year_inferred')) return 'Year inferred from your photo date';
  if (deal.status === 'expired') return 'This date has passed';
  if (deal.flags.includes('starts_later')) return 'Hasn’t started yet';
  return 'As printed on the poster';
}

/** Fine print for the tag row; "until close" is already in the time row. */
export function fineprint(deal: ApiDeal) {
  return deal.conditions.map((c) => c.trim()).filter((c) => c && !UNTIL_CLOSE.test(c));
}

/** Status pill: label and whether it reads as good news. */
export function statusLabel(deal: ApiDeal): { label: string; tone: 'orange' | 'success' } {
  const day = deal.end_date ?? deal.start_date;
  if (deal.status === 'expired') return { label: day ? `Expired · ${fmtDate(day)}` : 'Expired', tone: 'orange' };
  if (deal.status === 'stale') return { label: 'Old poster', tone: 'orange' };
  if (deal.status === 'needs_check') return { label: 'Needs a check', tone: 'orange' };
  if (deal.flags.includes('starts_later') && deal.start_date) {
    return { label: `Upcoming · ${fmtDate(deal.start_date)}`, tone: 'success' };
  }
  return { label: 'Live now', tone: 'success' };
}

/** Subtitle under "Quote found on the poster". */
export function verdictNote(deal: ApiDeal) {
  if (deal.status === 'expired') return 'Date has passed, so this deal is expired';
  if (deal.flags.includes('low_confidence')) return 'Parts of the photo were hard to read';
  if (deal.status === 'needs_check') return 'The poster doesn’t say when it runs';
  if (deal.status === 'stale') return 'This looks like an old poster';
  if (deal.flags.includes('starts_later')) return 'Confirmed, and it hasn’t started yet';
  return 'Everything here was read off your photo';
}

export function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
