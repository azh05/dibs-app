import { useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Text } from '@/components/text';
import { colors, fonts, radii } from '@/theme';

type Props = TextInputProps & {
  label: string;
  /** Status or control at the right edge: "✓ Available", the Student pill, the eye button. */
  trailing?: ReactNode;
  hint?: ReactNode;
};

// Figma "Field" on Create account: label, muted 50px input that turns white with an orange
// border while focused.
export function TextField({ label, trailing, hint, style, onFocus, onBlur, ...input }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text weight="semibold" size={13} color={colors.inkSecondary}>
        {label}
      </Text>
      <View style={[styles.box, focused && styles.focused]}>
        <TextInput
          placeholderTextColor={colors.inkTertiary}
          autoCorrect={false}
          {...input}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, style]}
        />
        {trailing}
      </View>
      {hint}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 50,
    paddingLeft: 16,
    paddingRight: 12,
    borderRadius: radii.thumb,
    borderWidth: 1.5,
    borderColor: colors.muted,
    backgroundColor: colors.muted,
  },
  focused: { borderColor: colors.orange, backgroundColor: colors.surface },
  input: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, letterSpacing: -0.16, color: colors.ink, paddingVertical: 0 },
});
