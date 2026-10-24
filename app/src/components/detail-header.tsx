import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CircleButton } from '@/components/button';
import { PostPreview } from '@/components/post-preview';
import type { SourcePost } from '@/lib/types';
import { colors, gutter } from '@/theme';

type Props = {
  post: SourcePost;
  /** Height below the status bar: 286 for deals, 276 for events (Figma 340 / 330 incl. status bar). */
  height: number;
  imageHeight: number;
  saved: boolean;
  onToggleSaved: () => void;
};

// Orange-soft header with the source post and back / bookmark buttons (deal and event detail).
export function DetailHeader({ post, height, imageHeight, saved, onToggleSaved }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { height: insets.top + height, paddingTop: insets.top + 24 }]}>
      <PostPreview post={post} imageHeight={imageHeight} />
      <View style={[styles.actions, { top: insets.top + 2 }]}>
        <CircleButton
          icon="back"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/deals'))}
        />
        <CircleButton
          icon="bookmark"
          accessibilityLabel={saved ? 'Remove bookmark' : 'Bookmark'}
          color={saved ? colors.orange : colors.ink}
          onPress={onToggleSaved}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.orangeSoft, alignItems: 'center', overflow: 'hidden' },
  actions: {
    position: 'absolute',
    left: gutter,
    right: gutter,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
