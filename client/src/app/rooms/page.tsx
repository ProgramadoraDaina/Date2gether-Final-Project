'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiError, getOwnedRooms, type OwnedRoom } from '@/lib/api';
import { isLoggedIn } from '@/lib/auth';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import { MyRoomMenu } from '@/features/rooms/MyRoomMenu';
import styles from './page.module.css';

const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default function MyRoomsPage() {
  const { t, language } = useTranslation();
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [rooms, setRooms] = useState<OwnedRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [visibilityNotice, setVisibilityNotice] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const visibleRooms = rooms.filter((room) => !!room.hiddenFromMyRooms === showHidden);
  const hasHiddenRooms = rooms.some((room) => room.hiddenFromMyRooms);

  // Runs once on mount; `t` is left out so changing language does not refetch.
  useEffect(() => {
    const alreadyLoggedIn = isLoggedIn();
    setLoggedIn(alreadyLoggedIn);
    setChecking(false);
    if (!alreadyLoggedIn) return;

    setLoading(true);
    getOwnedRooms()
      .then(setRooms)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t('No se pudieron cargar tus salas'));
        if (!isLoggedIn()) setLoggedIn(false);
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

  function updateRoomVisibility(roomId: string, hidden: boolean) {
    setRooms((current) =>
      current.map((room) => (room.id === roomId ? { ...room, hiddenFromMyRooms: hidden } : room)),
    );
    setVisibilityNotice(hidden ? 'La sala se quitó de tu lista.' : 'La sala volvió a tu lista.');
    headingRef.current?.focus();
  }

  if (checking) return null;

  if (!loggedIn) {
    return (
      <AppShell>
        <div className={styles.card}>
          <h1>{t('Mis salas')}</h1>
          <p>{t('Necesitás iniciar sesión para ver tus salas.')}</p>
          <p className={styles.authLinks}>
            <Link href="/login">{t('Iniciar sesión')}</Link>
            <Link href="/register">{t('Crear cuenta')}</Link>
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className={styles.card}>
        <h1 ref={headingRef} tabIndex={-1}>
          {t('Mis salas')}
        </h1>
        {(hasHiddenRooms || showHidden) && (
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              setShowHidden(!showHidden);
              setVisibilityNotice('');
            }}
          >
            {t(showHidden ? 'Volver a Mis salas' : 'Ver salas ocultas')}
          </button>
        )}
        {visibilityNotice && <p role="status">{t(visibilityNotice)}</p>}

        {loading && <p>{t('Cargando salas…')}</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!loading && !error && rooms.length === 0 && <p>{t('Todavía no creaste ninguna sala.')}</p>}
        {!loading && !error && rooms.length > 0 && visibleRooms.length === 0 && (
          <p>{t(showHidden ? 'No hay salas ocultas.' : 'No hay salas visibles en tu lista.')}</p>
        )}

        {visibleRooms.length > 0 && (
          <ul className={styles.list}>
            {visibleRooms.map((room) => (
              <li key={room.id} className={styles.room}>
                <div className={styles.roomHead}>
                  <strong className={styles.roomName}>{room.name}</strong>
                  {room.isPermanent && <span className={styles.badge}>{t('Permanente')}</span>}
                  {!room.isJoinable && (
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>{t('Vencida')}</span>
                  )}
                  <MyRoomMenu room={room} onVisibilityChange={updateRoomVisibility} />
                </div>
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
