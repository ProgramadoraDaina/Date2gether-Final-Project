'use client';

import type { ReactionKey } from './reactions';
import { useReactions } from './useReactions';
import styles from './Reactions.module.css';

// Dibuja un emoji estándar como texto o un emoji de la sala como imagen, al tamaño de la fuente.
export function ReactionGlyph({ reactionKey }: { reactionKey: ReactionKey }) {
  const glyph = useReactions().glyphFor(reactionKey);
  if (!glyph) return null;
  if (glyph.kind === 'text') return <>{glyph.text}</>;
  return <img className={styles.glyphImage} src={glyph.src} alt={`:${glyph.name}:`} />;
}
