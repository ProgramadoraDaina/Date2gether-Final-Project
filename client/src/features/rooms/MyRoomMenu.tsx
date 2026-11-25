'use client';

import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import { ApiError, clearRoomArchive, setMyRoomVisibility, type OwnedRoom } from '@/lib/api';
import styles from './MyRoomMenu.module.css';

export function MyRoomMenu({
  room,
  onVisibilityChange,
}: {
  room: OwnedRoom;
  onVisibilityChange: (roomId: string, hidden: boolean) => void;
}) {
  const { t } = useTranslation();
  const menu = useRef<HTMLDetailsElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const summary = useRef<HTMLElement>(null);
  const heading = useId();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState(false);
  const [changingVisibility, setChangingVisibility] = useState(false);
  const [visibilityError, setVisibilityError] = useState('');
  const canManageArchive = room.isPermanent && !room.hiddenFromMyRooms;

  async function confirm() {
    setDeleting(true);
    setError('');
    try {
      await clearRoomArchive(room.id);
      dialog.current?.close();
      setDeleted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo borrar el archivo de la sala');
    } finally {
      setDeleting(false);
    }
  }

  async function changeVisibility() {
    const hidden = !room.hiddenFromMyRooms;
    setChangingVisibility(true);
    setVisibilityError('');
    try {
      await setMyRoomVisibility(room.id, hidden);
      if (menu.current) menu.current.open = false;
      onVisibilityChange(room.id, hidden);
    } catch (err) {
      setVisibilityError(
        err instanceof ApiError ? err.message : 'No se pudo actualizar tu lista de salas',
      );
    } finally {
      setChangingVisibility(false);
    }
  }

  return (
    <div className={styles.root}>
      <details
        ref={menu}
        className={styles.menu}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menu.current?.open) {
            menu.current.open = false;
            summary.current?.focus();
          }
        }}
      >
        <summary ref={summary} aria-label={`${t('Opciones de la sala')} ${room.name}`}>
          ⋮
        </summary>
        <div className={styles.options}>
          <button
            type="button"
            disabled={changingVisibility}
            onClick={() => void changeVisibility()}
          >
            <span className={styles.optionLabel}>
              {t(room.hiddenFromMyRooms ? 'Volver a mostrar la sala' : 'Quitar de Mis salas')}
            </span>
            <span className={styles.optionHint}>
              {t(
                room.hiddenFromMyRooms
                  ? 'Vuelve a aparecer en esta lista.'
                  : 'La sala no se borra: solo deja de aparecer en esta lista.',
              )}
            </span>
          </button>
          {visibilityError && (
            <p className={styles.menuError} role="alert">
              {t(visibilityError)}
            </p>
          )}
          {canManageArchive && (
            <>
              <Link
                href={`/history?roomId=${room.id}&roomArchive=1`}
                onClick={() => {
                  if (menu.current) menu.current.open = false;
                }}
              >
                <span className={styles.optionLabel}>{t('Archivo compartido')}</span>
                <span className={styles.optionHint}>
                  {t('Llamadas de hace más de 90 días de todos los que usaron la sala.')}
                </span>
              </Link>
              <button
                type="button"
                className={styles.danger}
                disabled={changingVisibility}
                onClick={() => {
                  if (menu.current) menu.current.open = false;
                  setError('');
                  setDeleted(false);
                  dialog.current?.showModal();
                }}
              >
                <span className={styles.optionLabel}>{t('Borrar archivo compartido')}</span>
                <span className={styles.optionHint}>
                  {t('Mensajes y llamadas de hace más de 90 días, para todos.')}
                </span>
              </button>
            </>
          )}
        </div>
      </details>
      {canManageArchive && (
        <dialog
          ref={dialog}
          className={styles.dialog}
          aria-labelledby={heading}
          onClose={() => summary.current?.focus()}
          onCancel={(event) => {
            if (deleting) event.preventDefault();
          }}
        >
          <h2 id={heading}>{t('Borrar archivo compartido')}</h2>
          <p>
            <strong>{room.name}</strong>
          </p>
          <p>
            {t(
              'Se borrarán los mensajes y los registros compartidos de llamadas de hace más de 90 días para todos los participantes. Esta acción es permanente.',
            )}
          </p>
          {error && (
            <p className={styles.danger} role="alert">
              {t(error)}
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className="secondary"
              disabled={deleting}
              onClick={() => dialog.current?.close()}
            >
              {t('Cancelar')}
            </button>
            <button
              type="button"
              className={styles.dangerButton}
              disabled={deleting}
              onClick={() => void confirm()}
            >
              {t(deleting ? 'Borrando…' : 'Confirmar borrado')}
            </button>
          </div>
        </dialog>
      )}
      {deleted && (
        <small role="status">{t('Se retiraron los registros archivados de la sala.')}</small>
      )}
    </div>
  );
}
