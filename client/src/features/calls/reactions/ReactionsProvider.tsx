'use client';

import { useDataChannel, useLocalParticipant } from '@livekit/components-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  decodeReaction,
  encodeReaction,
  REACTION_LIFETIME_MS,
  REACTIONS_TOPIC,
  type Reaction,
  type ReactionEmoji,
} from './reactions';
import { ReactionsContext } from './useReactions';

const SEND_COOLDOWN_MS = 250;

export function ReactionsProvider({ children }: { children: ReactNode }) {
  const { localParticipant } = useLocalParticipant();
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const lastSentAt = useRef(0);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const addReaction = useCallback((emoji: ReactionEmoji, identity: string, name: string) => {
    const reaction: Reaction = { id: crypto.randomUUID(), emoji, identity, name, at: Date.now() };
    setReactions((prev) => [...prev, reaction]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
    }, REACTION_LIFETIME_MS);
    timers.current.add(timer);
  }, []);

  const { send } = useDataChannel(REACTIONS_TOPIC, (msg) => {
    const emoji = decodeReaction(msg.payload);
    if (!emoji || !msg.from) return;
    addReaction(emoji, msg.from.identity, msg.from.name || msg.from.identity);
  });

  const sendReaction = useCallback(
    (emoji: ReactionEmoji) => {
      const now = Date.now();
      if (now - lastSentAt.current < SEND_COOLDOWN_MS) return;
      lastSentAt.current = now;
      // LiveKit no le devuelve al emisor sus propios mensajes: se agrega localmente.
      addReaction(emoji, localParticipant.identity, localParticipant.name || '');
      void send(encodeReaction(emoji), { reliable: true, topic: REACTIONS_TOPIC });
    },
    [addReaction, localParticipant, send],
  );

  const value = useMemo(() => ({ reactions, sendReaction }), [reactions, sendReaction]);
  return <ReactionsContext.Provider value={value}>{children}</ReactionsContext.Provider>;
}
