'use client';

import { useDataChannel, useLocalParticipant } from '@livekit/components-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BURST_DURATION_MS,
  BURST_THRESHOLD,
  BURST_WINDOW_MS,
  decodeReaction,
  encodeReaction,
  REACTION_LIFETIME_MS,
  REACTIONS_TOPIC,
  type Reaction,
  type ReactionBurst,
  type ReactionEmoji,
} from './reactions';
import { createBurstPlan } from './burstEffects';
import { ReactionsContext } from './useReactions';

const SEND_COOLDOWN_MS = 250;

export function ReactionsProvider({ children }: { children: ReactNode }) {
  const { localParticipant } = useLocalParticipant();
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [bursts, setBursts] = useState<ReactionBurst[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const pendingBurst = useRef<Reaction[]>([]);
  const lastSentAt = useRef(0);

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

  const addReaction = useCallback(
    (emoji: ReactionEmoji, identity: string, name: string) => {
      const now = Date.now();
      const reaction: Reaction = {
        id: crypto.randomUUID(),
        emoji,
        identity,
        name,
        at: now,
        exploded: false,
      };
      pendingBurst.current = [
        ...pendingBurst.current.filter((r) => now - r.at < BURST_WINDOW_MS),
        reaction,
      ];

      if (pendingBurst.current.length >= BURST_THRESHOLD) {
        const burst = {
          id: reaction.id,
          plan: createBurstPlan(pendingBurst.current.map((r) => r.emoji)),
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
    [schedule],
  );

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

  const value = useMemo(
    () => ({ reactions, bursts, sendReaction }),
    [reactions, bursts, sendReaction],
  );
  return <ReactionsContext.Provider value={value}>{children}</ReactionsContext.Provider>;
}
