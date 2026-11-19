'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import { useDismiss } from '@/lib/useDismiss';
import { customReactionKey } from './reactions';
import { ReactionGlyph } from './ReactionGlyph';
import { useReactions } from './useReactions';
import styles from './Reactions.module.css';

export function SoundboardPicker({ buttonClassName }: { buttonClassName: string }) {
  const { t } = useTranslation();
  const { roomEmojis, playSoundForAll } = useReactions();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(
    open,
    wrapRef,
    useCallback(() => setOpen(false), []),
  );

  const emojisWithSound = roomEmojis.filter((e) => e.kind === 'emoji' && e.hasSound);
  const sounds = roomEmojis.filter((e) => e.kind === 'sound');
  if (emojisWithSound.length === 0 && sounds.length === 0) return null;

  const label = t('Botonera de sonidos');

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
          <path d="M11 5 6 9H2v6h4l5 4z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M19 5a10 10 0 0 1 0 14" />
        </svg>
      </button>
      {open && (
        <div className={styles.soundboard} role="toolbar" aria-label={label}>
          {emojisWithSound.length > 0 && (
            <section>
              <h3 className={styles.soundboardTitle}>{t('Emojis')}</h3>
              <div className={styles.soundboardEmojis}>
                {emojisWithSound.map((emoji) => (
                  <button
                    key={emoji.id}
                    type="button"
                    className={styles.pickerEmoji}
                    onClick={() => playSoundForAll(emoji.id)}
                    aria-label={`${t('Reproducir para todos')} :${emoji.name}:`}
                    title={`:${emoji.name}:`}
                  >
                    <ReactionGlyph reactionKey={customReactionKey(emoji.id)} />
                  </button>
                ))}
              </div>
            </section>
          )}
          {sounds.length > 0 && (
            <section>
              <h3 className={styles.soundboardTitle}>{t('Sonidos')}</h3>
              <div className={styles.soundboardSounds}>
                {sounds.map((sound) => (
                  <button
                    key={sound.id}
                    type="button"
                    className={styles.pickerSound}
                    onClick={() => playSoundForAll(sound.id)}
                    aria-label={`${t('Reproducir para todos')} :${sound.name}:`}
                    title={`:${sound.name}:`}
                  >
                    🔊 {sound.name}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
