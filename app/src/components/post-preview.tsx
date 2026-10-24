import { Image, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import type { SourcePost } from '@/lib/types';
import { colors, shadows } from '@/theme';

// The source post card at the top of the deal and event screens (Figma "Instagram post").
// With `imageUri` (a submitted photo) the photo fills the image area instead of the headline.
export function PostPreview({
  post,
  imageHeight,
  imageUri,
}: {
  post: SourcePost;
  imageHeight: number;
  imageUri?: string;
}) {
  return (
    <View style={[styles.card, shadows.post]}>
      <View style={styles.clip}>
        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: post.avatarColor }]}>
            <Text weight="extrabold" size={10} color={colors.surface}>
              {post.initials}
            </Text>
          </View>
          <Text weight="bold" size={13} style={{ flex: 1 }} numberOfLines={1}>
            {post.author}
          </Text>
          {post.postedAgo ? (
            <Text size={12} color={colors.inkTertiary}>
              {post.postedAgo}
            </Text>
          ) : null}
        </View>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={{ height: imageHeight }} resizeMode="cover" />
        ) : (
          <View style={[styles.image, { height: imageHeight, backgroundColor: post.imageColor }]}>
            <Text
              weight="extrabold"
              size={post.headlineSize}
              tracking={-post.headlineSize * 0.03}
              color={colors.surface}
              numberOfLines={1}
              adjustsFontSizeToFit>
              {post.headline}
            </Text>
            <Text weight="bold" size={11} tracking={0.66} color={post.sublineColor} numberOfLines={1}>
              {post.subline}
            </Text>
          </View>
        )}
        <View style={styles.caption}>
          <Text size={12} color={colors.inkSecondary} numberOfLines={3}>
            {post.caption}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: 250, backgroundColor: colors.surface, borderRadius: 20 },
  // Separate from the card so iOS keeps the shadow while the image is clipped to the corners.
  clip: { borderRadius: 20, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  avatar: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  image: { alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 12 },
  caption: { paddingHorizontal: 12, paddingVertical: 10 },
});
