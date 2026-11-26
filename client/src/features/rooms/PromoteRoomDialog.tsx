'use client';

import { useEffect, useId, useRef } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import styles from './PromoteRoomDialog.module.css';

interface PromoteRoomDialogProps {
  open: boolean;
  roomName: string;
  promoting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// Confirmation for the one-way temporary -> permanent promotion. Same native modal <dialog>
// pattern as DeleteRoomDialog: Escape cancels, and cancelling is blocked while the request runs.
export function PromoteRoomDialog({
  open,
  roomName,
  promoting,
  error,
  onConfirm,
  onCancel,
}: PromoteRoomDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

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
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(e) => {
        e.preventDefault();
        if (!promoting) onCancel();
      }}
    >
      <h2 id={titleId} className={styles.title}>
        {t('Hacer permanente')}
      </h2>
      <p id={descriptionId} className={styles.description}>
        {t('Vas a hacer permanente')} <strong>{roomName}</strong>.{' '}
        {t('Esta acción no se puede deshacer.')}
      </p>
      <ul className={styles.list}>
        <li>{t('La sala deja de vencer y conserva su código.')}</li>
        <li>{t('La sala de espera pasa a ser obligatoria y no se puede desactivar.')}</li>
      </ul>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={onCancel} disabled={promoting}>
          {t('Cancelar')}
        </button>
        <button type="button" className={styles.confirm} onClick={onConfirm} disabled={promoting}>
          {promoting ? t('Haciendo permanente…') : t('Sí, hacer permanente')}
        </button>
      </div>
    </dialog>
  );
}
