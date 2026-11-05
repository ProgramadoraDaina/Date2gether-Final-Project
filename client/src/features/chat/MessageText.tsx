'use client';

import { useMemo } from 'react';
import { roomEmojiImageUrl, roomEmojiSoundUrl, type RoomEmoji } from '@/lib/api';
import { splitRoomEmojiTokens } from './roomEmojiTokens';
import { RoomEmojiGlyph } from './RoomEmojiGlyph';
import styles from './MessageText.module.css';

interface MessageTextProps {
  text: string;
  roomCode: string;
  emojisByName: ReadonlyMap<string, RoomEmoji>;
}

export function MessageText({ text, roomCode, emojisByName }: MessageTextProps) {
  const segments = useMemo(() => splitRoomEmojiTokens(text, emojisByName), [text, emojisByName]);

  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === 'text') return <span key={i}>{segment.text}</span>;
        const { emoji } = segment;
        const label = `:${emoji.name}:`;
        // Suena solo al hacer click: reproducirlo al llegar cada mensaje sería insoportable.
        return emoji.hasSound ? (
          <button
            key={i}
            type="button"
            className={styles.soundEmoji}
            onClick={() => void new Audio(roomEmojiSoundUrl(roomCode, emoji.id)).play().catch(() => undefined)}
            title={`${label} 🔊`}
            aria-label={label}
          >
            <RoomEmojiGlyph emoji={emoji} src={roomEmojiImageUrl(roomCode, emoji.id)} />
          </button>
        ) : (
          <span key={i} className={styles.emoji} title={label}>
            <RoomEmojiGlyph emoji={emoji} src={roomEmojiImageUrl(roomCode, emoji.id)} />
          </span>
        );
      })}
    </>
  );
}
