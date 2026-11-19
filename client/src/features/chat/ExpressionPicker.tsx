'use client';

import { useCallback, useRef } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import type { RoomEmoji } from '@/lib/api';
import { useDismiss } from '@/lib/useDismiss';
import { EmojiPanel } from './EmojiPanel';
import styles from './ExpressionPicker.module.css';
import { GifPanel } from './GifPanel';
import { RoomEmojiPanel } from './RoomEmojiPanel';

export type ExpressionTab = 'emoji' | 'gif' | 'room';

// Controlado desde afuera: los atajos de la sala lo abren directo en la pestaña "Sala".
interface ExpressionPickerProps {
  roomCode: string;
  roomToken: string;
  roomEmojis: RoomEmoji[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: ExpressionTab;
  onTabChange: (tab: ExpressionTab) => void;
  onEmojiSelect: (emoji: string) => void;
  onGifSelect: (url: string) => void;
  onRoomEmojiSelect: (emoji: RoomEmoji) => void;
}

export function ExpressionPicker({
  roomCode,
  roomToken,
  roomEmojis,
  open,
  onOpenChange,
  tab,
  onTabChange,
  onEmojiSelect,
  onGifSelect,
  onRoomEmojiSelect,
}: ExpressionPickerProps) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(
    open,
    wrapRef,
    useCallback(() => onOpenChange(false), [onOpenChange]),
  );

  const label = t('Emojis y GIFs');
  const tabs: { id: ExpressionTab; label: string }[] = [
    { id: 'emoji', label: 'Emoji' },
    { id: 'gif', label: 'GIF' },
    { id: 'room', label: t('Sala') },
  ];

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => onOpenChange(!open)}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <line x1="9" y1="9" x2="9.01" y2="9" />
          <line x1="15" y1="9" x2="15.01" y2="9" />
        </svg>
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label={label}>
          <div className={styles.tabs} role="tablist">
            {tabs.map(({ id, label: tabLabel }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={styles.tab}
                onClick={() => onTabChange(id)}
              >
                {tabLabel}
              </button>
            ))}
          </div>
          <div className={styles.panel} role="tabpanel">
            {tab === 'emoji' && (
              <EmojiPanel
                onSelect={(emoji) => {
                  onEmojiSelect(emoji);
                  onOpenChange(false);
                }}
              />
            )}
            {tab === 'gif' && (
              <GifPanel
                roomCode={roomCode}
                roomToken={roomToken}
                onSelect={(url) => {
                  onGifSelect(url);
                  onOpenChange(false);
                }}
              />
            )}
            {tab === 'room' && (
              <RoomEmojiPanel
                roomCode={roomCode}
                emojis={roomEmojis}
                onSelect={(emoji) => {
                  onRoomEmojiSelect(emoji);
                  onOpenChange(false);
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
