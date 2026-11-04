'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import { useDismiss } from '@/lib/useDismiss';
import { EmojiPanel } from './EmojiPanel';
import styles from './ExpressionPicker.module.css';
import { GifPanel } from './GifPanel';

type Tab = 'emoji' | 'gif';

interface ExpressionPickerProps {
  roomCode: string;
  roomToken: string;
  onEmojiSelect: (emoji: string) => void;
  onGifSelect: (url: string) => void;
}

export function ExpressionPicker({
  roomCode,
  roomToken,
  onEmojiSelect,
  onGifSelect,
}: ExpressionPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('emoji');
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(
    open,
    wrapRef,
    useCallback(() => setOpen(false), []),
  );

  const label = t('Emojis y GIFs');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'emoji', label: 'Emoji' },
    { id: 'gif', label: 'GIF' },
  ];

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((value) => !value)}
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
                onClick={() => setTab(id)}
              >
                {tabLabel}
              </button>
            ))}
          </div>
          <div className={styles.panel} role="tabpanel">
            {tab === 'emoji' ? (
              <EmojiPanel
                onSelect={(emoji) => {
                  onEmojiSelect(emoji);
                  setOpen(false);
                }}
              />
            ) : (
              <GifPanel
                roomCode={roomCode}
                roomToken={roomToken}
                onSelect={(url) => {
                  onGifSelect(url);
                  setOpen(false);
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
