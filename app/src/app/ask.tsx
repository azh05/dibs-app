import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DealCard } from '@/components/deal-card';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { askDibs } from '@/lib/api';
import { combinedLine, useUserLocation } from '@/lib/line-check';
import { HOME } from '@/lib/mock';
import { getPushToken } from '@/lib/notifications';
import { useStore } from '@/lib/store';
import type { Deal } from '@/lib/types';
import { colors, fonts, gutter, radii } from '@/theme';

type Turn = { id: number; question: string; answer?: string; deals?: Deal[]; error?: string };

const SUGGESTIONS = ['Boba deals ending today near me?', 'Cheap haircut this week?', 'Ramen deals near me?'];

// Ask dibs (not in Figma yet): a chat with the Elastic Agent Builder agent. It answers from the deal index
// (Jina search, distance, ending soon) and can act through workflows: watch for deals or scan an area.
export default function AskScreen() {
  const insets = useSafeAreaInsets();
  const { saved, toggleSaved, lineReports } = useStore();
  const position = useUserLocation();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const conversation = useRef<string | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const nextId = useRef(0);

  useEffect(() => {
    getPushToken().then(setPushToken, () => undefined);
  }, []);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const id = ++nextId.current;
    setDraft('');
    setBusy(true);
    setTurns((t) => [...t, { id, question: q }]);
    try {
      const res = await askDibs(q, conversation.current, position ?? HOME, pushToken);
      conversation.current = res.conversationId;
      setTurns((t) => t.map((turn) => (turn.id === id ? { ...turn, answer: res.answer, deals: res.deals } : turn)));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setTurns((t) => t.map((turn) => (turn.id === id ? { ...turn, error: message } : turn)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.screen}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <Icon name="close" size={22} />
        </Pressable>
        <View style={styles.title}>
          <Icon name="sparkles" size={18} color={colors.orange} />
          <Text weight="extrabold" size={18} tracking={-0.18}>
            Ask dibs
          </Text>
        </View>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {turns.length === 0 && (
          <View style={{ gap: 10 }}>
            <Text size={14} color={colors.inkSecondary} style={{ lineHeight: 21 }}>
              Ask about deals near you in any language, then save the ones you want.
            </Text>
            {SUGGESTIONS.map((s) => (
              <Pressable key={s} onPress={() => ask(s)} accessibilityRole="button" style={styles.suggestion}>
                <Text weight="semibold" size={14}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {turns.map((turn) => (
          <View key={turn.id} style={{ gap: 10 }}>
            <View style={styles.question}>
              <Text weight="semibold" size={14} color={colors.surface}>
                {turn.question}
              </Text>
            </View>
            {/* Cards only: the agent's prose isn't shown, so every answer is something you can save. */}
            {turn.answer != null && !turn.deals?.length && (
              <Text size={14} color={colors.inkSecondary}>
                No deals to save for that right now. Try another search.
              </Text>
            )}
            {turn.error && (
              <Text size={14} color={colors.orange}>
                Couldn’t reach dibs: {turn.error}
              </Text>
            )}
            {turn.answer == null && !turn.error && (
              <ActivityIndicator color={colors.orange} style={{ alignSelf: 'flex-start' }} />
            )}
            {turn.deals?.map((d) => (
              <DealCard
                key={d.id}
                deal={d}
                line={combinedLine(d, lineReports)}
                saved={saved.has(d.id)}
                onPress={() => router.push(`/deal/${d.id}`)}
                onToggleSaved={() => toggleSaved(d.id)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => ask(draft)}
          placeholder="Ask about deals near you"
          placeholderTextColor={colors.inkTertiary}
          returnKeyType="send"
          editable={!busy}
          style={styles.input}
        />
        <Pressable
          onPress={() => ask(draft)}
          disabled={busy || !draft.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send"
          style={[styles.send, (busy || !draft.trim()) && { opacity: 0.4 }]}>
          <Icon name="arrow" size={18} color={colors.surface} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: gutter,
    paddingBottom: 12,
  },
  title: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  content: { gap: 18, paddingHorizontal: gutter, paddingBottom: 20 },
  suggestion: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  question: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: colors.ink,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: gutter,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.ink,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.orange,
  },
});
