'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import { useDismiss } from '@/lib/useDismiss';
import type { RoomEventParticipant } from './useRoomEvents';
import styles from './RoomEventButton.module.css';

interface RoomEventButtonProps {
  // Solo admin/colaborador puede armar un evento (misma vara que
  // RoomEmojisDialog): el padre decide si corresponde mostrar el botón.
  canManage: boolean;
  participants: RoomEventParticipant[];
  onStartRoulette(participantIds: string[]): void;
}

export function RoomEventButton({ canManage, participants, onStartRoulette }: RoomEventButtonProps) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDialogElement>(null);

  useDismiss(
    menuOpen,
    wrapRef,
    useCallback(() => setMenuOpen(false), []),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pickerOpen && !dialog.open) dialog.showModal();
    if (!pickerOpen && dialog.open) dialog.close();
  }, [pickerOpen]);

  const openRoulettePicker = useCallback(() => {
    setMenuOpen(false);
    // Por default entran todos los que están en la sala ahora mismo; de acá
    // se puede destildar a quien se quiera dejar afuera, o vaciar la
    // selección entera y armarla a mano (ver quickActions más abajo) — una
    // sola pantalla cubre las dos formas que pidió el usuario de ajustar
    // quién participa, en vez de un botón "ruleta" y otro separado
    // "personalizar ruleta" que terminan llevando al mismo lugar.
    setSelected(new Set(participants.map((p) => p.participantId)));
    setPickerOpen(true);
  }, [participants]);

  function toggle(participantId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(participantId)) next.delete(participantId);
      else next.add(participantId);
      return next;
    });
  }

  const allSelected = useMemo(
    () => participants.length > 0 && participants.every((p) => selected.has(p.participantId)),
    [participants, selected],
  );

  function handleSpin() {
    if (selected.size === 0) return;
    onStartRoulette([...selected]);
    setPickerOpen(false);
  }

  if (!canManage) return null;

  const label = t('Hacer evento');

  return (
    <>
      <div className={styles.wrap} ref={wrapRef}>
        <button
          type="button"
          className={styles.trigger}
          onClick={() => setMenuOpen((value) => !value)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          🎉 {label}
        </button>
        {menuOpen && (
          <div className={styles.menu} role="menu">
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={openRoulettePicker}
            >
              🎡 {t('Ruleta')}
            </button>
          </div>
        )}
      </div>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onClose={() => setPickerOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setPickerOpen(false);
        }}
      >
        <div className={styles.dialogHeader}>
          <h2>🎡 {t('Ruleta')}</h2>
          <button
            type="button"
            className={styles.dialogClose}
            onClick={() => setPickerOpen(false)}
            aria-label={t('Cerrar')}
          >
            ✕
          </button>
        </div>
        <div className={styles.quickActions}>
          <button
            type="button"
            onClick={() => setSelected(new Set(participants.map((p) => p.participantId)))}
            disabled={allSelected}
          >
            {t('Seleccionar todos')}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
            {t('Vaciar selección')}
          </button>
        </div>
        {participants.length === 0 ? (
          <p className={styles.empty}>{t('Todavía no hay nadie más en la sala.')}</p>
        ) : (
          <ul className={styles.participantList}>
            {participants.map((p) => (
              <li key={p.participantId} className={styles.participantRow}>
                <input
                  type="checkbox"
                  id={`roulette-${p.participantId}`}
                  checked={selected.has(p.participantId)}
                  onChange={() => toggle(p.participantId)}
                />
                <label htmlFor={`roulette-${p.participantId}`}>{p.userName}</label>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.dialogActions}>
          <button type="button" className="secondary" onClick={() => setPickerOpen(false)}>
            {t('Cancelar')}
          </button>
          <button type="button" onClick={handleSpin} disabled={selected.size === 0}>
            {t('Girar ruleta')}
          </button>
        </div>
      </dialog>
    </>
  );
}
