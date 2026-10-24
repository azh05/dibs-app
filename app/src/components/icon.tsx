import type { FC } from 'react';
import type { SvgProps } from 'react-native-svg';

import Back from '@/assets/icons/back.svg';
import Bag from '@/assets/icons/bag.svg';
import Bakery from '@/assets/icons/bakery.svg';
import Bar from '@/assets/icons/bar.svg';
import Bell from '@/assets/icons/bell.svg';
import Boba from '@/assets/icons/boba.svg';
import Book from '@/assets/icons/book.svg';
import Bookmark from '@/assets/icons/bookmark.svg';
import Boxing from '@/assets/icons/boxing.svg';
import Burger from '@/assets/icons/burger.svg';
import Calendar from '@/assets/icons/calendar.svg';
import Camera from '@/assets/icons/camera.svg';
import Car from '@/assets/icons/car.svg';
import Cart from '@/assets/icons/cart.svg';
import Check from '@/assets/icons/check.svg';
import Chevron from '@/assets/icons/chevron.svg';
import Climb from '@/assets/icons/climb.svg';
import Clock from '@/assets/icons/clock.svg';
import Coffee from '@/assets/icons/coffee.svg';
import Dumbbell from '@/assets/icons/dumbbell.svg';
import Film from '@/assets/icons/film.svg';
import Flame from '@/assets/icons/flame.svg';
import Flower from '@/assets/icons/flower.svg';
import Food from '@/assets/icons/food.svg';
import Game from '@/assets/icons/game.svg';
import Gift from '@/assets/icons/gift.svg';
import Globe from '@/assets/icons/globe.svg';
import Hair from '@/assets/icons/hair.svg';
import Icecream from '@/assets/icons/icecream.svg';
import Instagram from '@/assets/icons/instagram.svg';
import Juice from '@/assets/icons/juice.svg';
import Lashes from '@/assets/icons/lashes.svg';
import Laundry from '@/assets/icons/laundry.svg';
import MapIcon from '@/assets/icons/map.svg';
import Moon from '@/assets/icons/moon.svg';
import Music from '@/assets/icons/music.svg';
import Nails from '@/assets/icons/nails.svg';
import Navigation from '@/assets/icons/navigation.svg';
import Paw from '@/assets/icons/paw.svg';
import Percent from '@/assets/icons/percent.svg';
import Phone from '@/assets/icons/phone.svg';
import Pill from '@/assets/icons/pill.svg';
import Pin from '@/assets/icons/pin.svg';
import Pizza from '@/assets/icons/pizza.svg';
import Scissors from '@/assets/icons/scissors.svg';
import Search from '@/assets/icons/search.svg';
import Shirt from '@/assets/icons/shirt.svg';
import Sliders from '@/assets/icons/sliders.svg';
import Spa from '@/assets/icons/spa.svg';
import Sparkles from '@/assets/icons/sparkles.svg';
import Store from '@/assets/icons/store.svg';
import Student from '@/assets/icons/student.svg';
import Sushi from '@/assets/icons/sushi.svg';
import Tacos from '@/assets/icons/tacos.svg';
import Tag from '@/assets/icons/tag.svg';
import Tattoo from '@/assets/icons/tattoo.svg';
import User from '@/assets/icons/user.svg';
import Users from '@/assets/icons/users.svg';
import Verified from '@/assets/icons/verified.svg';
import Yoga from '@/assets/icons/yoga.svg';
import Zap from '@/assets/icons/zap.svg';
import { colors } from '@/theme';

// The Figma icon set (Components → Icons). Every glyph is drawn in ink (#16161A); .svgrrc maps
// that colour to currentColor so one asset serves every tint the design uses.
const icons = {
  back: Back,
  bag: Bag,
  bakery: Bakery,
  bar: Bar,
  bell: Bell,
  boba: Boba,
  book: Book,
  bookmark: Bookmark,
  boxing: Boxing,
  burger: Burger,
  calendar: Calendar,
  camera: Camera,
  car: Car,
  cart: Cart,
  check: Check,
  chevron: Chevron,
  climb: Climb,
  clock: Clock,
  coffee: Coffee,
  dumbbell: Dumbbell,
  film: Film,
  flame: Flame,
  flower: Flower,
  food: Food,
  game: Game,
  gift: Gift,
  globe: Globe,
  hair: Hair,
  icecream: Icecream,
  instagram: Instagram,
  juice: Juice,
  lashes: Lashes,
  laundry: Laundry,
  map: MapIcon,
  moon: Moon,
  music: Music,
  nails: Nails,
  navigation: Navigation,
  paw: Paw,
  percent: Percent,
  phone: Phone,
  pill: Pill,
  pin: Pin,
  pizza: Pizza,
  scissors: Scissors,
  search: Search,
  shirt: Shirt,
  sliders: Sliders,
  spa: Spa,
  sparkles: Sparkles,
  store: Store,
  student: Student,
  sushi: Sushi,
  tacos: Tacos,
  tag: Tag,
  tattoo: Tattoo,
  user: User,
  users: Users,
  verified: Verified,
  yoga: Yoga,
  zap: Zap,
} satisfies Record<string, FC<SvgProps>>;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 24, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  const Glyph = icons[name];
  return <Glyph width={size} height={size} color={color} />;
}
