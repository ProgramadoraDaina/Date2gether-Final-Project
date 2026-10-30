'use client';

import { useCallback, useRef, useState } from 'react';
import { useDismiss } from '@/lib/useDismiss';
import { useTranslation } from '@/features/translation/useTranslation';
import { customReactionKey, REACTION_EMOJIS } from './reactions';
import { ReactionGlyph } from './ReactionGlyph';
import { useReactions } from './useReactions';
import styles from './Reactions.module.css';

export function ReactionPicker({ buttonClassName }: { buttonClassName: string }) {
  const { t } = useTranslation();
  const { sendReaction, roomEmojis } = useReactions();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(
    open,
    wrapRef,
    useCallback(() => setOpen(false), []),
  );

  const label = t('Reaccionar');

  return (
    <div className={styles.pickerWrap} ref={wrapRef}>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => setOpen((value) => !value)}
        title={label}
        aria-label={label}
        aria-expanded={open}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
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
        <div className={styles.pickerBar} role="toolbar" aria-label={label}>
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={styles.pickerEmoji}
              onClick={() => sendReaction(emoji)}
              aria-label={`${label} ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          {roomEmojis.length > 0 && <span className={styles.pickerDivider} aria-hidden="true" />}
          {roomEmojis.map((emoji) => (
            <button
              key={emoji.id}
              type="button"
              className={styles.pickerEmoji}
              onClick={() => sendReaction(customReactionKey(emoji.id))}
              aria-label={`${label} :${emoji.name}:`}
              title={`:${emoji.name}:${emoji.hasSound ? ' 🔊' : ''}`}
            >
              <ReactionGlyph reactionKey={customReactionKey(emoji.id)} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
