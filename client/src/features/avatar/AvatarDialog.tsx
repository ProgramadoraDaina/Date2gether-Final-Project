'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useTranslation } from '../translation/useTranslation';
import { AvatarEditor } from './AvatarEditor';
import { saveMyAvatar } from './saveAvatar';
import { useAvatarStore } from './store';
import styles from './AvatarEditor.module.css';

interface AvatarDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AvatarDialog({ open, onClose }: AvatarDialogProps) {
  const { t } = useTranslation();
  const stored = useAvatarStore((s) => s.avatar);
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setDraft(useAvatarStore.getState().avatar);
      setError(null);
      dialog.showModal?.();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveMyAvatar(draft);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('No se pudo guardar el avatar'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="avatar-dialog-title"
    >
      <div className={styles.dialogHead}>
        <h2 id="avatar-dialog-title">{t('Personalizar avatar')}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t('Cerrar')}>
          ×
        </button>
      </div>
      {open && <AvatarEditor value={draft} onChange={setDraft} />}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.dialogActions}>
        <button type="button" className="secondary" onClick={onClose}>
          {t('Cancelar')}
        </button>
        <button type="button" onClick={handleSave} disabled={saving}>
          {saving ? t('Guardando…') : t('Guardar avatar')}
        </button>
      </div>
    </dialog>
  );
}
