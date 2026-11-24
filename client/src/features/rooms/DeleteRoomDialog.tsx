'use client';

import { useEffect, useRef } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import styles from './DeleteRoomDialog.module.css';

interface DeleteRoomDialogProps {
  open: boolean;
  roomName: string;
  deleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// Confirmación en la propia página (nada de window.confirm): un <dialog> modal nativo,
// igual que el resto de diálogos de la app.
export function DeleteRoomDialog({
  open,
  roomName,
  deleting,
  error,
  onConfirm,
  onCancel,
}: DeleteRoomDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="delete-room-title"
      aria-describedby="delete-room-description"
      // Escape cierra el <dialog>; mientras se borra no se puede cancelar.
      onCancel={(e) => {
        e.preventDefault();
        if (!deleting) onCancel();
      }}
    >
      <h2 id="delete-room-title" className={styles.title}>
        {t('Eliminar sala')}
      </h2>
      <p id="delete-room-description" className={styles.description}>
        {t('Vas a eliminar')} <strong>{roomName}</strong>.{' '}
        {t(
          'Se borran sus mensajes, notas, horarios y miembros. Esta acción no se puede deshacer.',
        )}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={onCancel} disabled={deleting}>
          {t('Cancelar')}
        </button>
        <button type="button" className={styles.confirm} onClick={onConfirm} disabled={deleting}>
          {deleting ? t('Eliminando…') : t('Sí, eliminar sala')}
        </button>
      </div>
    </dialog>
  );
}
