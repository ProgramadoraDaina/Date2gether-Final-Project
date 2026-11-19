'use client';

import { useState } from 'react';
import { useTranslation } from '../translation/useTranslation';
import { AvatarFigure } from './AvatarFigure';
import { AvatarStrip } from './AvatarStrip';
import {
  AVATAR_SLOTS,
  PIECES,
  SLOT_LABELS,
  idsOf,
  randomAvatar,
  togglePiece,
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
  const selectedIds = idsOf(avatar, slot);
  // "Nada" vacía todo el slot de un golpe: con multi-selección no tiene
  // sentido que represente "ninguna pieza puesta" como una opción más del
  // array (no es una pieza), así que queda aparte como botón de reset.
  const pieceIds = Object.keys(PIECES[slot]);

  return (
    <section className={styles.catalogSection} aria-label={t(SLOT_LABELS[slot])}>
      <h3 className={styles.stripLabel}>{t(SLOT_LABELS[slot])}</h3>
      <div className={styles.grid}>
        <button
          type="button"
          className={styles.thumb}
          aria-pressed={selectedIds.length === 0}
          aria-label={t('Nada')}
          title={t('Nada')}
          onClick={() => onChange(withPiece(avatar, slot, undefined))}
        >
          <AvatarFigure avatar={{ sticker: avatar.sticker }} animated={false} />
          <span>{t('Nada')}</span>
        </button>
        {pieceIds.map((id) => {
          const label = t(PIECES[slot][id].label);
          const selected = selectedIds.includes(id);
          return (
            <button
              key={id}
              type="button"
              className={styles.thumb}
              aria-pressed={selected}
              aria-label={label}
              title={label}
              onClick={() => onChange(togglePiece(avatar, slot, id))}
            >
              <AvatarFigure avatar={{ sticker: avatar.sticker, [slot]: [id] }} animated={false} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <SlotColors slot={slot} avatar={avatar} onChange={onChange} />
    </section>
  );
}
