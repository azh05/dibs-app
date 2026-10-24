// The interests you can tell your agent to watch, as on "02 · Pick interests" (Figma 27:887).
import type { IconName } from '@/components/icon';

export type Interest = { label: string; icon: IconName };

export const INTEREST_SECTIONS: { title: string; interests: Interest[] }[] = [
  {
    title: 'Food & drink',
    interests: [
      { label: 'Restaurants', icon: 'food' },
      { label: 'Fast food', icon: 'burger' },
      { label: 'Cafes', icon: 'coffee' },
      { label: 'Boba & tea', icon: 'boba' },
      { label: 'Juice & smoothies', icon: 'juice' },
      { label: 'Desserts & bakeries', icon: 'icecream' },
      { label: 'Bars', icon: 'bar' },
    ],
  },
  {
    title: 'Beauty & self-care',
    interests: [
      { label: 'Nails', icon: 'nails' },
      { label: 'Hair & barbers', icon: 'scissors' },
      { label: 'Lashes & brows', icon: 'lashes' },
      { label: 'Spa & massage', icon: 'spa' },
      { label: 'Tattoo & piercing', icon: 'tattoo' },
    ],
  },
  {
    title: 'Fitness',
    interests: [
      { label: 'Gyms', icon: 'dumbbell' },
      { label: 'Boxing & MMA', icon: 'boxing' },
      { label: 'Yoga & pilates', icon: 'yoga' },
      { label: 'Climbing', icon: 'climb' },
    ],
  },
  {
    title: 'Shopping',
    interests: [
      { label: 'Clothing & thrift', icon: 'shirt' },
      { label: 'Books', icon: 'book' },
      { label: 'Flowers', icon: 'flower' },
      { label: 'Tech & phone', icon: 'phone' },
    ],
  },
  {
    title: 'Fun',
    interests: [
      { label: 'Movies', icon: 'film' },
      { label: 'Arcades & bowling', icon: 'game' },
      { label: 'Live music', icon: 'music' },
    ],
  },
  {
    title: 'Everyday',
    interests: [
      { label: 'Grocery', icon: 'cart' },
      { label: 'Pharmacy', icon: 'pill' },
      { label: 'Laundry', icon: 'laundry' },
      { label: 'Car wash', icon: 'car' },
      { label: 'Pet care', icon: 'paw' },
    ],
  },
  {
    title: 'Deal types',
    interests: [
      { label: 'BOGO', icon: 'tag' },
      { label: '% off', icon: 'percent' },
      { label: 'Free stuff', icon: 'gift' },
      { label: 'Student deals', icon: 'student' },
      { label: 'Happy hour', icon: 'bar' },
      { label: 'Late night', icon: 'moon' },
      { label: 'New openings', icon: 'store' },
      { label: 'Upcoming events', icon: 'calendar' },
    ],
  },
];

export const INTERESTS = INTEREST_SECTIONS.flatMap((s) => s.interests);

/** Store types only: the deal types aren't counted in "Search 28 store types". */
export const STORE_TYPE_COUNT = INTEREST_SECTIONS.filter((s) => s.title !== 'Deal types').reduce(
  (n, s) => n + s.interests.length,
  0,
);

/** Choices for "Alert me about deals within", in miles. */
export const RADIUS_OPTIONS = [0.5, 1, 2, 5];
