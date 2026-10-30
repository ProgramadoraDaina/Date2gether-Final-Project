import { createContext, useContext } from 'react';
import type { RoomEmoji } from '@/lib/api';
import type { Reaction, ReactionBurst, ReactionKey } from './reactions';

export type ReactionGlyphData =
  | { kind: 'text'; text: string }
  | { kind: 'image'; src: string; name: string };

export interface ReactionsContextValue {
  reactions: Reaction[];
  bursts: ReactionBurst[];
  roomEmojis: RoomEmoji[];
  glyphFor: (key: ReactionKey) => ReactionGlyphData | null;
  sendReaction: (key: ReactionKey) => void;
}

export const ReactionsContext = createContext<ReactionsContextValue | null>(null);

export function useReactions(): ReactionsContextValue {
  const context = useContext(ReactionsContext);
  if (!context) throw new Error('useReactions must be used inside ReactionsProvider');
  return context;
}
