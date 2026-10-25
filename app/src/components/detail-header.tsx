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
  /** Gap from the status bar to the post card: 24 on deals, 26 on events (Figma). */
  postTop?: number;
  /** A submitted photo shown in place of the post image. */
  imageUri?: string;
  /** The bookmark button shows only when there is something to save. */
  saved?: boolean;
  onToggleSaved?: () => void;
};

// Orange-soft header with the source post and back / bookmark buttons (deal and event detail).
export function DetailHeader({
  post,
  height,
  imageHeight,
  postTop = 24,
  imageUri,
  saved = false,
  onToggleSaved,
}: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { height: insets.top + height, paddingTop: insets.top + postTop }]}>
      <PostPreview post={post} imageHeight={imageHeight} imageUri={imageUri} />
      <View style={[styles.actions, { top: insets.top + 2 }]}>
        <CircleButton
          icon="back"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/deals'))}
        />
        {onToggleSaved && (
          <CircleButton
            icon="bookmark"
            accessibilityLabel={saved ? 'Remove bookmark' : 'Bookmark'}
            color={saved ? colors.orange : colors.ink}
            onPress={onToggleSaved}
          />
        )}
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
