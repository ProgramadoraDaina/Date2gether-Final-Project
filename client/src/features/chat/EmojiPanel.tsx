'use client';

import { EmojiPicker } from 'frimousse';
import { useTranslation } from '@/features/translation/useTranslation';
import styles from './EmojiPanel.module.css';

export function EmojiPanel({ onSelect }: { onSelect: (emoji: string) => void }) {
  const { t, language } = useTranslation();

  return (
    <EmojiPicker.Root
      className={styles.picker}
      locale={language}
      columns={8}
      onEmojiSelect={({ emoji }) => onSelect(emoji)}
    >
      <EmojiPicker.Search className={styles.search} placeholder={t('Buscar emoji...')} autoFocus />
      <EmojiPicker.Viewport className={styles.viewport}>
        <EmojiPicker.Loading className={styles.status}>{t('Cargando…')}</EmojiPicker.Loading>
        <EmojiPicker.Empty className={styles.status}>{t('No se encontraron emojis')}</EmojiPicker.Empty>
        <EmojiPicker.List
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div {...props} className={styles.categoryHeader}>
                {category.label}
              </div>
            ),
            Row: ({ children, ...props }) => (
              <div {...props} className={styles.row}>
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button {...props} className={styles.emoji}>
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </EmojiPicker.Viewport>
    </EmojiPicker.Root>
  );
}
