import type { FC } from 'react';
import type { SvgProps } from 'react-native-svg';

import Back from '@/assets/icons/back.svg';
import Bell from '@/assets/icons/bell.svg';
import Boba from '@/assets/icons/boba.svg';
import Bookmark from '@/assets/icons/bookmark.svg';
import Boxing from '@/assets/icons/boxing.svg';
import Burger from '@/assets/icons/burger.svg';
import Calendar from '@/assets/icons/calendar.svg';
import Camera from '@/assets/icons/camera.svg';
import Cart from '@/assets/icons/cart.svg';
import Check from '@/assets/icons/check.svg';
import Chevron from '@/assets/icons/chevron.svg';
import Clock from '@/assets/icons/clock.svg';
import Coffee from '@/assets/icons/coffee.svg';
import Dumbbell from '@/assets/icons/dumbbell.svg';
import Food from '@/assets/icons/food.svg';
import Gift from '@/assets/icons/gift.svg';
import Globe from '@/assets/icons/globe.svg';
import Instagram from '@/assets/icons/instagram.svg';
import MapIcon from '@/assets/icons/map.svg';
import Navigation from '@/assets/icons/navigation.svg';
import Pin from '@/assets/icons/pin.svg';
import Scissors from '@/assets/icons/scissors.svg';
import Search from '@/assets/icons/search.svg';
import Sliders from '@/assets/icons/sliders.svg';
import Tag from '@/assets/icons/tag.svg';
import User from '@/assets/icons/user.svg';
import Users from '@/assets/icons/users.svg';
import Verified from '@/assets/icons/verified.svg';
import Zap from '@/assets/icons/zap.svg';
import { colors } from '@/theme';

// The Figma icon set (Components → Icons). Every glyph is drawn in ink (#16161A); .svgrrc maps
// that colour to currentColor so one asset serves every tint the design uses.
const icons = {
  back: Back,
  bell: Bell,
  boba: Boba,
  bookmark: Bookmark,
  boxing: Boxing,
  burger: Burger,
  calendar: Calendar,
  camera: Camera,
  cart: Cart,
  check: Check,
  chevron: Chevron,
  clock: Clock,
  coffee: Coffee,
  dumbbell: Dumbbell,
  food: Food,
  gift: Gift,
  globe: Globe,
  instagram: Instagram,
  map: MapIcon,
  navigation: Navigation,
  pin: Pin,
  scissors: Scissors,
  search: Search,
  sliders: Sliders,
  tag: Tag,
  user: User,
  users: Users,
  verified: Verified,
  zap: Zap,
} satisfies Record<string, FC<SvgProps>>;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 24, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  const Glyph = icons[name];
  return <Glyph width={size} height={size} color={color} />;
}
