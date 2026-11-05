import type { RoomEmoji } from '@/lib/api';
import styles from './MessageText.module.css';

// Emoji de sala al tamaño de la letra: carácter Unicode o imagen subida.
export function RoomEmojiGlyph({ emoji, src }: { emoji: RoomEmoji; src: string }) {
  if (emoji.emoji) return <>{emoji.emoji}</>;
  return <img className={styles.glyphImage} src={src} alt={`:${emoji.name}:`} />;
}
