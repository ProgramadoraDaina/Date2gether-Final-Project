'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, getOwnedRooms, renameRoom, type OwnedRoom } from '@/lib/api';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import styles from './page.module.css';

const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default function MyRoomsPage() {
  return (
    <RequireAuth>
      <MyRoomsContent />
    </RequireAuth>
  );
}

function MyRoomsContent() {
  const { t, language } = useTranslation();
  const [rooms, setRooms] = useState<OwnedRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  // Runs once on mount; `t` is left out so changing language does not refetch.
  useEffect(() => {
    setLoading(true);
    getOwnedRooms()
      .then(setRooms)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t('No se pudieron cargar tus salas'));
      })
      .finally(() => setLoading(false));
  }, []);

  function formatNext(iso: string): string {
    return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  }

  async function copyLink(room: OwnedRoom) {
    await navigator.clipboard.writeText(`${window.location.origin}/room/${room.code}`);
    setCopiedId(room.id);
  }

  function startEditing(room: OwnedRoom) {
    setEditingId(room.id);
    setEditValue(room.name);
    setRenameError(null);
  }

  function cancelEditing() {
    setEditingId(null);
    setRenameError(null);
  }

  async function saveRename(room: OwnedRoom) {
    const newName = editValue.trim();
    if (!newName) return;
    try {
      await renameRoom(room.code, newName);
      setRooms((prev) => prev.map((r) => (r.id === room.id ? { ...r, name: newName } : r)));
      setEditingId(null);
    } catch (err) {
      setRenameError(err instanceof ApiError ? err.message : t('No se pudo renombrar la sala'));
    }
  }

  return (
    <AppShell>
      <div className={styles.card}>
        <h1>{t('Mis salas')}</h1>

        {loading && <p>{t('Cargando salas…')}</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!loading && !error && rooms.length === 0 && <p>{t('Todavía no creaste ninguna sala.')}</p>}

        {rooms.length > 0 && (
          <ul className={styles.list}>
            {rooms.map((room) => (
              <li key={room.id} className={styles.room}>
                <div className={styles.roomHead}>
                  {editingId === room.id ? (
                    <span className={styles.renameRow}>
                      <input
                        className={styles.renameInput}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        maxLength={100}
                        aria-label={t('Nuevo nombre de la sala')}
                        autoFocus
                      />
                      <button
                        type="button"
                        className={styles.action}
                        onClick={() => void saveRename(room)}
                        disabled={!editValue.trim()}
                      >
                        {t('Guardar cambios')}
                      </button>
                      <button type="button" className={styles.action} onClick={cancelEditing}>
                        {t('Cancelar edición')}
                      </button>
                    </span>
                  ) : (
                    <>
                      <strong className={styles.roomName}>{room.name}</strong>
                      {room.isPermanent && (
                        <button
                          type="button"
                          className={styles.renameButton}
                          onClick={() => startEditing(room)}
                          aria-label={t('Renombrar sala')}
                          title={t('Renombrar sala')}
                        >
                          ✏️
                        </button>
                      )}
                    </>
                  )}
                  {room.isPermanent && <span className={styles.badge}>{t('Permanente')}</span>}
                  {!room.isJoinable && (
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>{t('Vencida')}</span>
                  )}
                </div>
                {editingId === room.id && renameError && (
                  <p className={styles.error} role="alert">
                    {renameError}
                  </p>
                )}
                <span className={styles.code}>{room.code}</span>
                {room.slots.length > 0 && (
                  <p className={styles.slots}>
                    {room.slots
                      .map((slot) => `${t(DAY_LABELS[slot.dayOfWeek])} ${slot.timeOfDay}`)
                      .join(' · ')}
                  </p>
                )}
                {room.nextOccurrenceAt && (
                  <p className={styles.next}>
                    {t('Próximo encuentro')}: <span>{formatNext(room.nextOccurrenceAt)}</span>
                  </p>
                )}
                <div className={styles.actions}>
                  {room.isJoinable && (
                    <Link href={`/room/${room.code}`} className={styles.primaryAction}>
                      {t('Entrar')}
                    </Link>
                  )}
                  {room.isJoinable && (
                    <button
                      type="button"
                      className={styles.action}
                      onClick={() => void copyLink(room)}
                    >
                      {t('Copiar link')}
                    </button>
                  )}
                  <Link href={`/history?roomId=${room.id}`} className={styles.action}>
                    {t('Ver historial')}
                  </Link>
                  {copiedId === room.id && (
                    <span className={styles.copied} role="status">
                      {t('Link copiado')}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
