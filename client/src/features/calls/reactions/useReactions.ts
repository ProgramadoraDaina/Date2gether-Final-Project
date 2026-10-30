import { createContext, useContext } from 'react';
import type { Reaction, ReactionBurst, ReactionEmoji } from './reactions';

export interface ReactionsContextValue {
  reactions: Reaction[];
  bursts: ReactionBurst[];
  sendReaction: (emoji: ReactionEmoji) => void;
}

export const ReactionsContext = createContext<ReactionsContextValue | null>(null);

export function useReactions(): ReactionsContextValue {
  const context = useContext(ReactionsContext);
  if (!context) throw new Error('useReactions must be used inside ReactionsProvider');
  return context;
}
