import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { colors, fonts, radii, shadows } from '@/theme';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  onFilters?: () => void;
  /** White with a shadow when it floats over the map; muted grey otherwise. */
  floating?: boolean;
  /** The smaller 42px bar without a filters button (Pick interests). */
  compact?: boolean;
};

export function SearchBar({ value, onChangeText, placeholder, onFilters, floating = false, compact = false }: Props) {
  return (
    <View
      style={[
        styles.bar,
        floating ? [styles.floating, shadows.floating] : styles.muted,
        compact && styles.compact,
      ]}>
      <Icon name="search" size={compact ? 18 : 20} color={colors.inkTertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkTertiary}
        style={[styles.input, compact && { fontSize: 14 }]}
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCorrect={false}
      />
      {!compact && (
        <Pressable onPress={onFilters} hitSlop={10} accessibilityRole="button" accessibilityLabel="Filters">
          <Icon name="sliders" size={20} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 14,
    height: 48,
    borderRadius: radii.button,
  },
  muted: { backgroundColor: colors.muted },
  floating: { backgroundColor: colors.surface },
  compact: { height: 42, paddingLeft: 14, borderRadius: radii.thumb },
  input: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.ink, paddingVertical: 0 },
});
