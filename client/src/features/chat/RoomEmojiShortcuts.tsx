'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import { roomEmojiImageUrl, type RoomEmoji } from '@/lib/api';
import { RoomEmojiGlyph } from './RoomEmojiGlyph';
import styles from './RoomEmojiShortcuts.module.css';

const SCROLL_STEP_PX = 160;

interface RoomEmojiShortcutsProps {
  roomCode: string;
  emojis: RoomEmoji[];
  onSelect: (emoji: RoomEmoji) => void;
  onShowAll: () => void;
}

// sessionStorage: la posición dura lo que dura la pestaña (esa llamada), no para siempre.
function storageKey(roomCode: string) {
  return `date2gether:emojiShortcutsScroll:${roomCode}`;
}

export function RoomEmojiShortcuts({ roomCode, emojis, onSelect, onShowAll }: RoomEmojiShortcutsProps) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () =>
      setOverflow({
        left: track.scrollLeft > 0,
        right: track.scrollLeft + track.clientWidth < track.scrollWidth - 1,
      });
    try {
      track.scrollLeft = Number(sessionStorage.getItem(storageKey(roomCode))) || 0;
    } catch {
      // Sin storage (modo privado bloqueado): se arranca desde el principio.
    }
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [roomCode, emojis.length]);

  function handleScroll() {
    const track = trackRef.current;
    if (!track) return;
    setOverflow({
      left: track.scrollLeft > 0,
      right: track.scrollLeft + track.clientWidth < track.scrollWidth - 1,
    });
    try {
      sessionStorage.setItem(storageKey(roomCode), String(Math.round(track.scrollLeft)));
    } catch {
      // Si no se puede guardar, solo se pierde la memoria de la posición.
    }
  }

  function scrollBy(delta: number) {
    if (trackRef.current) trackRef.current.scrollLeft += delta;
  }

  if (emojis.length === 0) return null;

  return (
    <div className={styles.bar} role="toolbar" aria-label={t('Emojis de la sala')}>
      {overflow.left && (
        <button
          type="button"
          className={styles.arrow}
          onClick={() => scrollBy(-SCROLL_STEP_PX)}
          aria-label={t('Ver anteriores')}
        >
          ‹
        </button>
      )}
      <div className={styles.track} ref={trackRef} onScroll={handleScroll}>
        {emojis.map((emoji) => (
          <button
            key={emoji.id}
            type="button"
            className={styles.shortcut}
            onClick={() => onSelect(emoji)}
            title={`:${emoji.name}:${emoji.hasSound ? ' 🔊' : ''}`}
            aria-label={`:${emoji.name}:`}
          >
            <RoomEmojiGlyph emoji={emoji} src={roomEmojiImageUrl(roomCode, emoji.id)} />
          </button>
        ))}
      </div>
      {overflow.right && (
        <button
          type="button"
          className={styles.arrow}
          onClick={() => scrollBy(SCROLL_STEP_PX)}
          aria-label={t('Ver siguientes')}
        >
          ›
        </button>
      )}
      <button
        type="button"
        className={styles.arrow}
        onClick={onShowAll}
        aria-label={t('Ver todos los emojis de la sala')}
        title={t('Ver todos los emojis de la sala')}
      >
        +
      </button>
    </div>
  );
}
