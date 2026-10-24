import { Text as RNText, type TextProps } from 'react-native';

import { colors, fonts, type FontWeight } from '@/theme';

type Props = TextProps & {
  weight?: FontWeight;
  size?: number;
  color?: string;
  /** Letter spacing in px, as in Figma's tracking. */
  tracking?: number;
};

/** Plus Jakarta Sans text. Custom fonts pick their weight by family name, not fontWeight. */
export function Text({ weight = 'medium', size = 14, color = colors.ink, tracking, style, ...rest }: Props) {
  return (
    <RNText {...rest} style={[{ fontFamily: fonts[weight], fontSize: size, color, letterSpacing: tracking }, style]} />
  );
}
