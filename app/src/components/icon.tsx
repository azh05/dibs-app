import type { FC } from 'react';
import type { SvgProps } from 'react-native-svg';

import Activity from '@/assets/icons/activity.svg';
import Arrow from '@/assets/icons/arrow.svg';
import Back from '@/assets/icons/back.svg';
import Bag from '@/assets/icons/bag.svg';
import Bakery from '@/assets/icons/bakery.svg';
import Ball from '@/assets/icons/ball.svg';
import Bar from '@/assets/icons/bar.svg';
import Basket from '@/assets/icons/basket.svg';
import Bath from '@/assets/icons/bath.svg';
import Bed from '@/assets/icons/bed.svg';
import Bell from '@/assets/icons/bell.svg';
import Bike from '@/assets/icons/bike.svg';
import Blocks from '@/assets/icons/blocks.svg';
import Boba from '@/assets/icons/boba.svg';
import Book from '@/assets/icons/book.svg';
import Bookmark from '@/assets/icons/bookmark.svg';
import Bottle from '@/assets/icons/bottle.svg';
import Box from '@/assets/icons/box.svg';
import Boxing from '@/assets/icons/boxing.svg';
import Building from '@/assets/icons/building.svg';
import Burger from '@/assets/icons/burger.svg';
import Calendar from '@/assets/icons/calendar.svg';
import Camera from '@/assets/icons/camera.svg';
import Cannabis from '@/assets/icons/cannabis.svg';
import Car from '@/assets/icons/car.svg';
import Cart from '@/assets/icons/cart.svg';
import Check from '@/assets/icons/check.svg';
import Chevron from '@/assets/icons/chevron.svg';
import Climb from '@/assets/icons/climb.svg';
import Clock from '@/assets/icons/clock.svg';
import Close from '@/assets/icons/close.svg';
import Cloud from '@/assets/icons/cloud.svg';
import Club from '@/assets/icons/club.svg';
import Coffee from '@/assets/icons/coffee.svg';
import Dance from '@/assets/icons/dance.svg';
import Disc from '@/assets/icons/disc.svg';
import Droplet from '@/assets/icons/droplet.svg';
import Dumbbell from '@/assets/icons/dumbbell.svg';
import Eye from '@/assets/icons/eye.svg';
import Ferris from '@/assets/icons/ferris.svg';
import Film from '@/assets/icons/film.svg';
import Flag from '@/assets/icons/flag.svg';
import Flame from '@/assets/icons/flame.svg';
import Flower from '@/assets/icons/flower.svg';
import Food from '@/assets/icons/food.svg';
import Fuel from '@/assets/icons/fuel.svg';
import Game from '@/assets/icons/game.svg';
import Gear from '@/assets/icons/gear.svg';
import Gem from '@/assets/icons/gem.svg';
import Gift from '@/assets/icons/gift.svg';
import Glasses from '@/assets/icons/glasses.svg';
import Globe from '@/assets/icons/globe.svg';
import Hair from '@/assets/icons/hair.svg';
import Hookah from '@/assets/icons/hookah.svg';
import Icecream from '@/assets/icons/icecream.svg';
import Instagram from '@/assets/icons/instagram.svg';
import Joystick from '@/assets/icons/joystick.svg';
import Juice from '@/assets/icons/juice.svg';
import Key from '@/assets/icons/key.svg';
import Landmark from '@/assets/icons/landmark.svg';
import Laptop from '@/assets/icons/laptop.svg';
import Lashes from '@/assets/icons/lashes.svg';
import Laundry from '@/assets/icons/laundry.svg';
import Lipstick from '@/assets/icons/lipstick.svg';
import Lock from '@/assets/icons/lock.svg';
import Mail from '@/assets/icons/mail.svg';
import MapIcon from '@/assets/icons/map.svg';
import Masks from '@/assets/icons/masks.svg';
import Mic from '@/assets/icons/mic.svg';
import Monitor from '@/assets/icons/monitor.svg';
import Moon from '@/assets/icons/moon.svg';
import Music from '@/assets/icons/music.svg';
import Nails from '@/assets/icons/nails.svg';
import Navigation from '@/assets/icons/navigation.svg';
import Palette from '@/assets/icons/palette.svg';
import Parking from '@/assets/icons/parking.svg';
import Paw from '@/assets/icons/paw.svg';
import Percent from '@/assets/icons/percent.svg';
import Phone from '@/assets/icons/phone.svg';
import Pill from '@/assets/icons/pill.svg';
import Pin from '@/assets/icons/pin.svg';
import Pizza from '@/assets/icons/pizza.svg';
import Printer from '@/assets/icons/printer.svg';
import Racket from '@/assets/icons/racket.svg';
import Ruler from '@/assets/icons/ruler.svg';
import Scissors from '@/assets/icons/scissors.svg';
import Search from '@/assets/icons/search.svg';
import Shirt from '@/assets/icons/shirt.svg';
import Shoe from '@/assets/icons/shoe.svg';
import Sliders from '@/assets/icons/sliders.svg';
import Sofa from '@/assets/icons/sofa.svg';
import Spa from '@/assets/icons/spa.svg';
import Sparkles from '@/assets/icons/sparkles.svg';
import Sprout from '@/assets/icons/sprout.svg';
import Stethoscope from '@/assets/icons/stethoscope.svg';
import Store from '@/assets/icons/store.svg';
import Student from '@/assets/icons/student.svg';
import Sun from '@/assets/icons/sun.svg';
import Sushi from '@/assets/icons/sushi.svg';
import Syringe from '@/assets/icons/syringe.svg';
import Tacos from '@/assets/icons/tacos.svg';
import Tag from '@/assets/icons/tag.svg';
import Tattoo from '@/assets/icons/tattoo.svg';
import Tooth from '@/assets/icons/tooth.svg';
import Truck from '@/assets/icons/truck.svg';
import User from '@/assets/icons/user.svg';
import Users from '@/assets/icons/users.svg';
import Verified from '@/assets/icons/verified.svg';
import Waves from '@/assets/icons/waves.svg';
import Wrench from '@/assets/icons/wrench.svg';
import Yoga from '@/assets/icons/yoga.svg';
import Zap from '@/assets/icons/zap.svg';
import { colors } from '@/theme';

// The Figma icon set (Components → Icons). Every glyph is drawn in ink (#16161A); .svgrrc maps
// that colour to currentColor so one asset serves every tint the design uses.
const icons = {
  activity: Activity,
  arrow: Arrow,
  back: Back,
  bag: Bag,
  bakery: Bakery,
  ball: Ball,
  bar: Bar,
  basket: Basket,
  bath: Bath,
  bed: Bed,
  bell: Bell,
  bike: Bike,
  blocks: Blocks,
  boba: Boba,
  book: Book,
  bookmark: Bookmark,
  bottle: Bottle,
  box: Box,
  boxing: Boxing,
  building: Building,
  burger: Burger,
  calendar: Calendar,
  camera: Camera,
  cannabis: Cannabis,
  car: Car,
  cart: Cart,
  check: Check,
  chevron: Chevron,
  climb: Climb,
  clock: Clock,
  close: Close,
  cloud: Cloud,
  club: Club,
  coffee: Coffee,
  dance: Dance,
  disc: Disc,
  droplet: Droplet,
  dumbbell: Dumbbell,
  eye: Eye,
  ferris: Ferris,
  film: Film,
  flag: Flag,
  flame: Flame,
  flower: Flower,
  food: Food,
  fuel: Fuel,
  game: Game,
  gear: Gear,
  gem: Gem,
  gift: Gift,
  glasses: Glasses,
  globe: Globe,
  hair: Hair,
  hookah: Hookah,
  icecream: Icecream,
  instagram: Instagram,
  joystick: Joystick,
  juice: Juice,
  key: Key,
  landmark: Landmark,
  laptop: Laptop,
  lashes: Lashes,
  laundry: Laundry,
  lipstick: Lipstick,
  lock: Lock,
  mail: Mail,
  map: MapIcon,
  masks: Masks,
  mic: Mic,
  monitor: Monitor,
  moon: Moon,
  music: Music,
  nails: Nails,
  navigation: Navigation,
  palette: Palette,
  parking: Parking,
  paw: Paw,
  percent: Percent,
  phone: Phone,
  pill: Pill,
  pin: Pin,
  pizza: Pizza,
  printer: Printer,
  racket: Racket,
  ruler: Ruler,
  scissors: Scissors,
  search: Search,
  shirt: Shirt,
  shoe: Shoe,
  sliders: Sliders,
  sofa: Sofa,
  spa: Spa,
  sparkles: Sparkles,
  sprout: Sprout,
  stethoscope: Stethoscope,
  store: Store,
  student: Student,
  sun: Sun,
  sushi: Sushi,
  syringe: Syringe,
  tacos: Tacos,
  tag: Tag,
  tattoo: Tattoo,
  tooth: Tooth,
  truck: Truck,
  user: User,
  users: Users,
  verified: Verified,
  waves: Waves,
  wrench: Wrench,
  yoga: Yoga,
  zap: Zap,
} satisfies Record<string, FC<SvgProps>>;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 24, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  const Glyph = icons[name];
  return <Glyph width={size} height={size} color={color} />;
}
