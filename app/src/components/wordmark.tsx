import { View } from 'react-native';

import TittleInk from '@/assets/shapes/tittle-ink.svg';
import TittleOrange from '@/assets/shapes/tittle-orange.svg';
import { Text } from '@/components/text';
import { colors } from '@/theme';

// Figma "Logo / Wordmark" (3:52): "dıbs" (dotless i) in ExtraBold with the tittle drawn as a dot.
// Sizes and the dot position are proportions of the 204 × 126 master.
const BASE = { width: 204, height: 126, fontSize: 100, tracking: -2 };
const DOT = { left: 0.3271, top: 0.1778, right: 0.5704, bottom: 0.6635 };

type Props = {
  /** Rendered height in px; width follows the master's aspect ratio. */
  height: number;
  color?: string;
  dot?: 'orange' | 'ink';
};

export function Wordmark({ height, color = colors.ink, dot = 'orange' }: Props) {
  const scale = height / BASE.height;
  const width = BASE.width * scale;
  const Tittle = dot === 'orange' ? TittleOrange : TittleInk;
  return (
    <View style={{ width, height }} accessibilityRole="image" accessibilityLabel="dibs">
      <Text
        weight="extrabold"
        size={BASE.fontSize * scale}
        tracking={BASE.tracking * scale}
        color={color}
        style={{ position: 'absolute', left: 0, top: 0, right: -width * 0.0462, includeFontPadding: false }}>
        dıbs
      </Text>
      <View
        style={{
          position: 'absolute',
          left: width * DOT.left,
          top: height * DOT.top,
          right: width * DOT.right,
          bottom: height * DOT.bottom,
        }}>
        <Tittle width="100%" height="100%" color={colors.ink} />
      </View>
    </View>
  );
}
