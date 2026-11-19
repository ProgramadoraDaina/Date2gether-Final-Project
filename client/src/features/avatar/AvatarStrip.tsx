'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from '../translation/useTranslation';
import { AvatarFigure } from './AvatarFigure';
import { PIECES, SLOT_LABELS, idsOf, withPiece, type Avatar, type AvatarSlot } from './catalog';
import { SlotColors } from './SlotColors';
import styles from './AvatarEditor.module.css';

const SWIPE_THRESHOLD = 40;

interface AvatarStripProps {
  slot: AvatarSlot;
  avatar: Avatar;
  onChange: (avatar: Avatar) => void;
}

// Franja tipo mascota virtual: desliza con el dedo (o flechas) y da la vuelta en bucle.
export function AvatarStrip({ slot, avatar, onChange }: AvatarStripProps) {
  const { t } = useTranslation();
  const ids: (string | undefined)[] = [undefined, ...Object.keys(PIECES[slot])];
  // El probador es un carrusel de a una pieza por vez: siempre reemplaza todo
  // el slot (ver withPiece), así que "actual" es la de más arriba del
  // stack armado en la pestaña Catálogo.
  const topId = idsOf(avatar, slot).at(-1);
  const index = Math.max(0, ids.indexOf(topId));
  const [dragX, setDragX] = useState(0);
  const [slide, setSlide] = useState<{ dir: 'next' | 'prev'; n: number } | null>(null);
  const startX = useRef<number | null>(null);

  const at = (offset: number) => ids[(index + offset + ids.length) % ids.length];
  const labelOf = (id: string | undefined) => (id ? t(PIECES[slot][id].label) : t('Nada'));

  function step(dir: 1 | -1) {
    setSlide((prev) => ({ dir: dir === 1 ? 'next' : 'prev', n: (prev?.n ?? 0) + 1 }));
    onChange(withPiece(avatar, slot, at(dir)));
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (startX.current !== null) setDragX(e.clientX - startX.current);
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    if (startX.current === null) return;
    const dx = e.clientX - startX.current;
    startX.current = null;
    setDragX(0);
    if (dx <= -SWIPE_THRESHOLD) step(1);
    else if (dx >= SWIPE_THRESHOLD) step(-1);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  }

  const slotLabel = t(SLOT_LABELS[slot]);

  return (
    <div className={styles.strip}>
      <div className={styles.stripHead}>
        <span className={styles.stripLabel}>{slotLabel}</span>
        <span className={styles.stripValue} aria-live="polite">
          {labelOf(at(0))}
        </span>
      </div>
      <div className={styles.stripRow}>
        <button
          type="button"
          className={styles.arrow}
          onClick={() => step(-1)}
          aria-label={`${slotLabel}: ${t('Anterior')}`}
        >
          ‹
        </button>
        <div
          className={styles.viewport}
          role="group"
          aria-label={`${slotLabel}. ${t('Deslizá para cambiar')}`}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          data-testid={`avatar-strip-${slot}`}
        >
          <div
            key={slide?.n ?? 0}
            className={`${styles.track} ${slide ? styles[slide.dir] : ''}`}
            style={dragX ? { transform: `translateX(${dragX}px)` } : undefined}
          >
            {[-1, 0, 1].map((offset) => (
              <div
                key={offset}
                className={`${styles.cell} ${offset === 0 ? styles.cellCurrent : ''}`}
              >
                <AvatarFigure
                  avatar={withPiece(avatar, slot, at(offset))}
                  animated={offset === 0}
                />
              </div>
            ))}
          </div>
        </div>
        <button
          type="button"
          className={styles.arrow}
          onClick={() => step(1)}
          aria-label={`${slotLabel}: ${t('Siguiente')}`}
        >
          ›
        </button>
      </div>
      <SlotColors slot={slot} avatar={avatar} onChange={onChange} />
    </div>
  );
}
