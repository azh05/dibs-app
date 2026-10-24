// The one taxonomy behind Pick interests, Filters, the Deals chips and alert matching
// (Figma "04 · Pick interests" and "08 · Filters"). 72 store types in sections, plus deal types.
import type { IconName } from '@/components/icon';

export type Interest = { label: string; icon: IconName };

export type InterestSection = {
  title: string;
  /** Row icon on the Filters screen. */
  icon: IconName;
  interests: Interest[];
  /** 21+ sections stay locked until the user verifies their age. */
  adult?: boolean;
};

export const STORE_SECTIONS: InterestSection[] = [
  {
    title: 'Food & drink',
    icon: 'food',
    interests: [
      { label: 'Restaurants', icon: 'food' },
      { label: 'Cafes', icon: 'coffee' },
      { label: 'Boba & tea', icon: 'boba' },
      { label: 'Desserts & bakeries', icon: 'icecream' },
      { label: 'Fast food', icon: 'burger' },
      { label: 'Juice & smoothies', icon: 'juice' },
      { label: 'Food trucks', icon: 'truck' },
    ],
  },
  {
    title: 'Beauty & self-care',
    icon: 'sparkles',
    interests: [
      { label: 'Nails', icon: 'nails' },
      { label: 'Hair & barbers', icon: 'scissors' },
      { label: 'Spa & massage', icon: 'spa' },
      { label: 'Lashes & brows', icon: 'lashes' },
      { label: 'Waxing', icon: 'droplet' },
      { label: 'Med spa', icon: 'syringe' },
      { label: 'Tanning', icon: 'sun' },
      { label: 'Tattoo & piercing', icon: 'tattoo' },
    ],
  },
  {
    title: 'Fitness',
    icon: 'dumbbell',
    interests: [
      { label: 'Gyms', icon: 'dumbbell' },
      { label: 'Boxing & martial arts', icon: 'boxing' },
      { label: 'Yoga & pilates', icon: 'yoga' },
      { label: 'Climbing', icon: 'climb' },
      { label: 'Cycling', icon: 'bike' },
      { label: 'Dance', icon: 'dance' },
      { label: 'Swim', icon: 'waves' },
      { label: 'Racket sports', icon: 'racket' },
    ],
  },
  {
    title: 'Shopping',
    icon: 'bag',
    interests: [
      { label: 'Clothing & thrift', icon: 'shirt' },
      { label: 'Shoes & sneakers', icon: 'shoe' },
      { label: 'Beauty & cosmetics', icon: 'lipstick' },
      { label: 'Electronics', icon: 'monitor' },
      { label: 'Jewelry', icon: 'gem' },
      { label: 'Books', icon: 'book' },
      { label: 'Records', icon: 'disc' },
      { label: 'Art supplies', icon: 'palette' },
      { label: 'Furniture & home', icon: 'sofa' },
      { label: 'Sporting goods', icon: 'ball' },
      { label: 'Toys & games', icon: 'blocks' },
      { label: 'Plants & flowers', icon: 'sprout' },
      { label: 'Phones & repair', icon: 'phone' },
      { label: 'Bags & accessories', icon: 'bag' },
    ],
  },
  {
    title: 'Fun',
    icon: 'film',
    interests: [
      { label: 'Movies', icon: 'film' },
      { label: 'Live music', icon: 'music' },
      { label: 'Arcades & bowling', icon: 'joystick' },
      { label: 'Comedy & theater', icon: 'masks' },
      { label: 'Museums', icon: 'landmark' },
      { label: 'Escape rooms', icon: 'key' },
      { label: 'Mini golf', icon: 'flag' },
      { label: 'Theme parks', icon: 'ferris' },
    ],
  },
  {
    title: 'Health',
    icon: 'pill',
    interests: [
      { label: 'Pharmacy', icon: 'pill' },
      { label: 'Dental', icon: 'tooth' },
      { label: 'Eye care & glasses', icon: 'glasses' },
      { label: 'Chiro & physio', icon: 'activity' },
    ],
  },
  {
    title: 'Everyday',
    icon: 'basket',
    interests: [
      { label: 'Grocery', icon: 'cart' },
      { label: 'Convenience stores', icon: 'basket' },
      { label: 'Laundry & dry cleaning', icon: 'laundry' },
      { label: 'Printing & shipping', icon: 'printer' },
      { label: 'Tailoring', icon: 'ruler' },
      { label: 'Moving & storage', icon: 'box' },
      { label: 'Coworking', icon: 'laptop' },
      { label: 'Banks', icon: 'building' },
    ],
  },
  {
    title: 'Auto',
    icon: 'car',
    interests: [
      { label: 'Gas', icon: 'fuel' },
      { label: 'Car wash', icon: 'car' },
      { label: 'Auto repair', icon: 'gear' },
      { label: 'Parking', icon: 'parking' },
    ],
  },
  {
    title: 'Pets',
    icon: 'paw',
    interests: [
      { label: 'Pet stores', icon: 'paw' },
      { label: 'Grooming', icon: 'bath' },
      { label: 'Vets', icon: 'stethoscope' },
    ],
  },
  {
    title: 'Stays',
    icon: 'bed',
    interests: [{ label: 'Hotels & staycations', icon: 'bed' }],
  },
  {
    title: 'Nightlife',
    icon: 'club',
    adult: true,
    interests: [
      { label: 'Bars & breweries', icon: 'bar' },
      { label: 'Clubs', icon: 'club' },
      { label: 'Lounges & hookah', icon: 'hookah' },
      { label: 'Karaoke', icon: 'mic' },
    ],
  },
  {
    title: '21+ shops',
    icon: 'cloud',
    adult: true,
    interests: [
      { label: 'Liquor stores', icon: 'bottle' },
      { label: 'Smoke & vape', icon: 'cloud' },
      { label: 'Dispensaries', icon: 'cannabis' },
    ],
  },
];

export const DEAL_TYPES: Interest[] = [
  { label: 'BOGO', icon: 'tag' },
  { label: '% off', icon: 'percent' },
  { label: 'Free stuff', icon: 'gift' },
  { label: 'Student deals', icon: 'student' },
  { label: 'Happy hour', icon: 'bar' },
  { label: 'Late night', icon: 'moon' },
  { label: 'New openings', icon: 'store' },
  { label: 'Upcoming events', icon: 'calendar' },
];

export const STORE_TYPES = STORE_SECTIONS.flatMap((s) => s.interests);

export const STORE_TYPE_COUNT = STORE_TYPES.length;

/** Everything a user can pick, in display order (store types, then deal types). */
export const INTERESTS = [...STORE_TYPES, ...DEAL_TYPES];

/** What a new account starts with: the picks shown in the Figma frame ("15 picked"). */
export const DEFAULT_INTERESTS = [
  'Restaurants',
  'Cafes',
  'Boba & tea',
  'Desserts & bakeries',
  'Nails',
  'Hair & barbers',
  'Spa & massage',
  'Gyms',
  'Clothing & thrift',
  'Shoes & sneakers',
  'BOGO',
  '% off',
  'Free stuff',
  'Student deals',
  'Upcoming events',
];

/** Choices for "Alert me about deals within" and the Filters distance, in miles. */
export const RADIUS_OPTIONS = [0.5, 1, 2, 5];

export function sectionOf(storeType: string) {
  return STORE_SECTIONS.find((s) => s.interests.some((i) => i.label === storeType));
}

export function interestIcon(label: string): IconName {
  return INTERESTS.find((i) => i.label === label)?.icon ?? 'tag';
}
