'use client';

import { useTranslation } from '../translation/useTranslation';
import { AVATAR_PALETTE, PIECES, colorOf, idsOf, withColor, type Avatar, type AvatarSlot } from './catalog';
import styles from './AvatarEditor.module.css';

interface SlotColorsProps {
  slot: AvatarSlot;
  avatar: Avatar;
  onChange: (avatar: Avatar) => void;
}

// Cada pieza seleccionada en el slot tiene su propio color: con corona +
// tiara puestas a la vez, por ejemplo, hace falta un selector por pieza en
// vez de uno solo para todo el slot.
export function SlotColors({ slot, avatar, onChange }: SlotColorsProps) {
  const { t } = useTranslation();
  const ids = idsOf(avatar, slot);
  if (ids.length === 0) return null;

  return (
    <>
      {ids.map((id) => {
        const piece = PIECES[slot][id];
        if (!piece) return null;
        const color = colorOf(avatar, slot, id) ?? piece.color;
        return (
          <div
            key={id}
            className={styles.colors}
            role="group"
            aria-label={`${t('Color')}: ${t(piece.label)}`}
          >
            {AVATAR_PALETTE.map((hex) => (
              <button
                key={hex}
                type="button"
                className={styles.swatch}
                style={{ background: hex }}
                aria-pressed={color.toLowerCase() === hex}
                aria-label={hex}
                onClick={() => onChange(withColor(avatar, slot, id, hex))}
              />
            ))}
            <input
              type="color"
              className={styles.customColor}
              value={color}
              aria-label={t('Color libre')}
              onChange={(e) => onChange(withColor(avatar, slot, id, e.target.value))}
            />
          </div>
        );
      })}
    </>
  );
}
