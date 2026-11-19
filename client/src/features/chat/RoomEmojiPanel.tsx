'use client';

import { useTranslation } from '@/features/translation/useTranslation';
import { roomEmojiImageUrl, type RoomEmoji } from '@/lib/api';
import { RoomEmojiGlyph } from './RoomEmojiGlyph';
import styles from './RoomEmojiPanel.module.css';

interface RoomEmojiPanelProps {
  roomCode: string;
  emojis: RoomEmoji[];
  onSelect: (emoji: RoomEmoji) => void;
}

export function RoomEmojiPanel({ roomCode, emojis, onSelect }: RoomEmojiPanelProps) {
  const { t } = useTranslation();

  if (emojis.length === 0) {
    return (
      <p className={styles.empty}>
        {t('Esta sala todavía no tiene emojis propios. Se crean desde "Emojis de la sala".')}
      </p>
    );
  }

  return (
    <div className={styles.grid}>
      {emojis.map((emoji) => (
        <button
          key={emoji.id}
          type="button"
          className={styles.item}
          onClick={() => onSelect(emoji)}
          title={`:${emoji.name}:${emoji.hasSound ? ' 🔊' : ''}`}
        >
          <span className={styles.glyph}>
            <RoomEmojiGlyph emoji={emoji} src={roomEmojiImageUrl(roomCode, emoji)} />
          </span>
          <span className={styles.name}>:{emoji.name}:</span>
        </button>
      ))}
    </div>
  );
}
