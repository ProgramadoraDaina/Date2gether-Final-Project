'use client';

import { useMemo } from 'react';
import { roomEmojiImageUrl, roomEmojiSoundUrl, type RoomEmoji } from '@/lib/api';
import { isJumboEmojiMessage, splitRoomEmojiTokens } from './roomEmojiTokens';
import { RoomEmojiGlyph } from './RoomEmojiGlyph';
import { splitMentions } from './mentions';
import styles from './MessageText.module.css';

interface MessageTextProps {
  text: string;
  roomCode: string;
  emojisByName: ReadonlyMap<string, RoomEmoji>;
  mentionNames?: readonly string[];
}

export function MessageText({ text, roomCode, emojisByName, mentionNames = [] }: MessageTextProps) {
  const segments = useMemo(() => splitRoomEmojiTokens(text, emojisByName), [text, emojisByName]);

  const content = segments.map((segment, i) => {
    if (segment.kind === 'text') {
      return (
        <span key={i}>
          {splitMentions(segment.text, mentionNames).map((part, index) =>
            part.mention ? (
              <mark key={index} className={styles.mention}>
                {part.text}
              </mark>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </span>
      );
    }
    const { emoji } = segment;
    const label = `:${emoji.name}:`;
    // Suena solo al hacer click: reproducirlo al llegar cada mensaje sería insoportable.
    return emoji.hasSound ? (
      <button
        key={i}
        type="button"
        className={styles.soundEmoji}
        onClick={() =>
          void new Audio(roomEmojiSoundUrl(roomCode, emoji)).play().catch(() => undefined)
        }
        title={`${label} 🔊`}
        aria-label={label}
      >
        <RoomEmojiGlyph emoji={emoji} src={roomEmojiImageUrl(roomCode, emoji)} />
      </button>
    ) : (
      <span key={i} className={styles.emoji} title={label}>
        <RoomEmojiGlyph emoji={emoji} src={roomEmojiImageUrl(roomCode, emoji)} />
      </span>
    );
  });

  return isJumboEmojiMessage(segments) ? (
    <span className={styles.jumbo}>{content}</span>
  ) : (
    <>{content}</>
  );
}
