'use client';

import { useDataChannel, useLocalParticipant } from '@livekit/components-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { roomEmojiImageUrl, roomEmojiSoundUrl, type RoomEmoji } from '@/lib/api';
import {
  BURST_DURATION_MS,
  BURST_THRESHOLD,
  BURST_WINDOW_MS,
  customIdOf,
  customReactionKey,
  decodeReaction,
  decodeSound,
  encodeReaction,
  encodeSound,
  REACTION_LIFETIME_MS,
  REACTIONS_TOPIC,
  SOUNDS_TOPIC,
  type Reaction,
  type ReactionBurst,
  type ReactionKey,
} from './reactions';
import { createBurstPlan } from './burstEffects';
import { ReactionsContext, type ReactionGlyphData } from './useReactions';

const SEND_COOLDOWN_MS = 250;
// Con varias personas spameando sonidos, se cortan los que superan este tope por segundo.
const MAX_SOUNDS_PER_SECOND = 3;

interface ReactionsProviderProps {
  children: ReactNode;
  roomCode: string;
  roomEmojis: RoomEmoji[];
}

export function ReactionsProvider({ children, roomCode, roomEmojis }: ReactionsProviderProps) {
  const { localParticipant } = useLocalParticipant();
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [bursts, setBursts] = useState<ReactionBurst[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const pendingBurst = useRef<Reaction[]>([]);
  const lastSentAt = useRef(0);
  const lastSoundSentAt = useRef(0);
  const recentSounds = useRef<number[]>([]);

  const emojisById = useMemo(() => new Map(roomEmojis.map((e) => [e.id, e])), [roomEmojis]);
  // El callback del data channel puede quedar con un cierre viejo: se lee siempre la última lista.
  const emojisByIdRef = useRef(emojisById);
  useEffect(() => {
    emojisByIdRef.current = emojisById;
  }, [emojisById]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      fn();
    }, ms);
    timers.current.add(timer);
  }, []);

  const playSound = useCallback(
    (key: ReactionKey) => {
      const id = customIdOf(key);
      if (!id || !emojisByIdRef.current.get(id)?.hasSound) return;
      const now = Date.now();
      recentSounds.current = recentSounds.current.filter((at) => now - at < 1000);
      if (recentSounds.current.length >= MAX_SOUNDS_PER_SECOND) return;
      recentSounds.current.push(now);
      void new Audio(roomEmojiSoundUrl(roomCode, id)).play().catch(() => undefined);
    },
    [roomCode],
  );

  const addReaction = useCallback(
    (key: ReactionKey, identity: string, name: string) => {
      const now = Date.now();
      const reaction: Reaction = {
        id: crypto.randomUUID(),
        key,
        identity,
        name,
        at: now,
        exploded: false,
      };
      playSound(key);
      pendingBurst.current = [
        ...pendingBurst.current.filter((r) => now - r.at < BURST_WINDOW_MS),
        reaction,
      ];

      if (pendingBurst.current.length >= BURST_THRESHOLD) {
        const burst = {
          id: reaction.id,
          plan: createBurstPlan(pendingBurst.current.map((r) => r.key)),
        };
        const explodedIds = new Set(pendingBurst.current.map((r) => r.id));
        pendingBurst.current = [];
        setReactions((prev) => [
          ...prev.map((r) => (explodedIds.has(r.id) ? { ...r, exploded: true } : r)),
          { ...reaction, exploded: true },
        ]);
        setBursts((prev) => [...prev, burst]);
        schedule(() => setBursts((prev) => prev.filter((b) => b.id !== burst.id)), BURST_DURATION_MS);
      } else {
        setReactions((prev) => [...prev, reaction]);
      }

      schedule(
        () => setReactions((prev) => prev.filter((r) => r.id !== reaction.id)),
        REACTION_LIFETIME_MS,
      );
    },
    [playSound, schedule],
  );

  const { send } = useDataChannel(REACTIONS_TOPIC, (msg) => {
    const emojiIds = new Set(
      [...emojisByIdRef.current.values()].filter((e) => e.kind === 'emoji').map((e) => e.id),
    );
    const key = decodeReaction(msg.payload, emojiIds);
    if (!key || !msg.from) return;
    addReaction(key, msg.from.identity, msg.from.name || msg.from.identity);
  });

  const sendReaction = useCallback(
    (key: ReactionKey) => {
      const now = Date.now();
      if (now - lastSentAt.current < SEND_COOLDOWN_MS) return;
      lastSentAt.current = now;
      // LiveKit no le devuelve al emisor sus propios mensajes: se agrega localmente.
      addReaction(key, localParticipant.identity, localParticipant.name || '');
      void send(encodeReaction(key), { reliable: true, topic: REACTIONS_TOPIC });
    },
    [addReaction, localParticipant, send],
  );

  const { send: sendSoundData } = useDataChannel(SOUNDS_TOPIC, (msg) => {
    const soundIds = new Set(
      [...emojisByIdRef.current.values()].filter((e) => e.hasSound).map((e) => e.id),
    );
    const id = decodeSound(msg.payload, soundIds);
    if (id) playSound(customReactionKey(id));
  });

  const playSoundForAll = useCallback(
    (roomEmojiId: string) => {
      const now = Date.now();
      if (now - lastSoundSentAt.current < SEND_COOLDOWN_MS) return;
      lastSoundSentAt.current = now;
      playSound(customReactionKey(roomEmojiId));
      void sendSoundData(encodeSound(roomEmojiId), { reliable: true, topic: SOUNDS_TOPIC });
    },
    [playSound, sendSoundData],
  );

  const glyphFor = useCallback(
    (key: ReactionKey): ReactionGlyphData | null => {
      const id = customIdOf(key);
      if (!id) return { kind: 'text', text: key };
      const emoji = emojisById.get(id);
      if (!emoji) return null;
      if (emoji.kind === 'sound') return { kind: 'text', text: '🔊' };
      if (emoji.emoji) return { kind: 'text', text: emoji.emoji };
      return { kind: 'image', src: roomEmojiImageUrl(roomCode, id), name: emoji.name };
    },
    [emojisById, roomCode],
  );

  const value = useMemo(
    () => ({ reactions, bursts, roomEmojis, glyphFor, sendReaction, playSoundForAll }),
    [reactions, bursts, roomEmojis, glyphFor, sendReaction, playSoundForAll],
  );
  return <ReactionsContext.Provider value={value}>{children}</ReactionsContext.Provider>;
}
