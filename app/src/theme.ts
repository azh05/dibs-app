// Design tokens from the Figma file "dibs — App Design" (variables + brand page).

export const colors = {
  ink: '#16161A',
  inkSecondary: '#5F6168',
  inkTertiary: '#9A9CA3',
  orange: '#FF5A1F',
  orangeSoft: '#FFF1EA',
  surface: '#FFFFFF',
  muted: '#F5F5F7',
  border: '#ECECEF',
  success: '#17A34A',
  // Map pin recency (Fresh → 1 day → 1 week+ gets lighter).
  pinFresh: '#FF5A1F',
  pinDay: '#FF7140',
  pinWeek: '#FF8A61',
} as const;

export const fonts = {
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

export type FontWeight = keyof typeof fonts;

export const radii = {
  thumb: 14,
  card: 20,
  button: 16,
  pill: 999,
} as const;

/** Horizontal page gutter used on every screen. */
export const gutter = 20;

export const shadows = {
  floating: {
    shadowColor: '#17171A',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  button: {
    shadowColor: '#17171A',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  post: {
    shadowColor: '#17171A',
    shadowOpacity: 0.12,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
  },
} as const;
