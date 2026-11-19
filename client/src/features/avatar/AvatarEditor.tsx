'use client';

import { useState } from 'react';
import { useTranslation } from '../translation/useTranslation';
import { AvatarFigure } from './AvatarFigure';
import { AvatarStrip } from './AvatarStrip';
import {
  AVATAR_SLOTS,
  PIECES,
  SLOT_LABELS,
  randomAvatar,
  withPiece,
  type Avatar,
  type AvatarSlot,
} from './catalog';
import { SlotColors } from './SlotColors';
import styles from './AvatarEditor.module.css';

type Mode = 'pet' | 'catalog';

interface AvatarEditorProps {
  value: Avatar;
  onChange: (avatar: Avatar) => void;
}

export function AvatarEditor({ value, onChange }: AvatarEditorProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('pet');
  const [talking, setTalking] = useState(false);

  return (
    <div className={styles.editor}>
      <div className={styles.preview}>
        <AvatarFigure avatar={value} speaking={talking} label={t('Tu avatar')} />
        <button
          type="button"
          className={styles.talkButton}
          aria-pressed={talking}
          onClick={() => setTalking((v) => !v)}
        >
          {t('Probar cómo habla')}
        </button>
      </div>

      <div className={styles.tabs} role="tablist" aria-label={t('Forma de elegir')}>
        {(['pet', 'catalog'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={styles.tab}
            onClick={() => setMode(m)}
          >
            {m === 'pet' ? t('Probador') : t('Catálogo')}
          </button>
        ))}
      </div>

      <div role="tabpanel" className={styles.panel}>
        {mode === 'pet'
          ? AVATAR_SLOTS.map((slot) => (
              <AvatarStrip key={slot} slot={slot} avatar={value} onChange={onChange} />
            ))
          : AVATAR_SLOTS.map((slot) => (
              <CatalogSection key={slot} slot={slot} avatar={value} onChange={onChange} />
            ))}
      </div>

      <div className={styles.options}>
        <label className={styles.stickerToggle}>
          <input
            type="checkbox"
            checked={value.sticker}
            onChange={(e) => onChange({ ...value, sticker: e.target.checked })}
          />
          {t('Borde sticker')}
        </label>
        <button
          type="button"
          className="secondary"
          onClick={() => onChange(randomAvatar(value.sticker))}
        >
          {t('Al azar')}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => onChange({ sticker: value.sticker })}
        >
          {t('Quitar todo')}
        </button>
      </div>
    </div>
  );
}

interface CatalogSectionProps {
  slot: AvatarSlot;
  avatar: Avatar;
  onChange: (avatar: Avatar) => void;
}

function CatalogSection({ slot, avatar, onChange }: CatalogSectionProps) {
  const { t } = useTranslation();
  const current = avatar[slot];
  const options: (string | undefined)[] = [undefined, ...Object.keys(PIECES[slot])];

  return (
    <section className={styles.catalogSection} aria-label={t(SLOT_LABELS[slot])}>
      <h3 className={styles.stripLabel}>{t(SLOT_LABELS[slot])}</h3>
      <div className={styles.grid}>
        {options.map((id) => {
          const label = id ? t(PIECES[slot][id].label) : t('Nada');
          return (
            <button
              key={id ?? 'none'}
              type="button"
              className={styles.thumb}
              aria-pressed={current === id}
              aria-label={label}
              title={label}
              onClick={() => onChange(withPiece(avatar, slot, id))}
            >
              <AvatarFigure avatar={{ sticker: avatar.sticker, [slot]: id }} animated={false} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <SlotColors slot={slot} avatar={avatar} onChange={onChange} />
    </section>
  );
}
