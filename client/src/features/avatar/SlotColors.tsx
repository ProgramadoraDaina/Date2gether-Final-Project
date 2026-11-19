'use client';

import { useTranslation } from '../translation/useTranslation';
import {
  AVATAR_PALETTE,
  SLOT_LABELS,
  colorOf,
  withColor,
  type Avatar,
  type AvatarSlot,
} from './catalog';
import styles from './AvatarEditor.module.css';

interface SlotColorsProps {
  slot: AvatarSlot;
  avatar: Avatar;
  onChange: (avatar: Avatar) => void;
}

export function SlotColors({ slot, avatar, onChange }: SlotColorsProps) {
  const { t } = useTranslation();
  const color = colorOf(avatar, slot);
  if (!avatar[slot] || !color) return null;

  return (
    <div
      className={styles.colors}
      role="group"
      aria-label={`${t('Color')}: ${t(SLOT_LABELS[slot])}`}
    >
      {AVATAR_PALETTE.map((hex) => (
        <button
          key={hex}
          type="button"
          className={styles.swatch}
          style={{ background: hex }}
          aria-pressed={color.toLowerCase() === hex}
          aria-label={hex}
          onClick={() => onChange(withColor(avatar, slot, hex))}
        />
      ))}
      <input
        type="color"
        className={styles.customColor}
        value={color}
        aria-label={t('Color libre')}
        onChange={(e) => onChange(withColor(avatar, slot, e.target.value))}
      />
    </div>
  );
}
