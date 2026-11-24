'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ApiError,
  getCallHistory,
  getOwnedRooms,
  type CallHistoryEntry,
  type OwnedRoom,
} from '@/lib/api';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import styles from './page.module.css';

// useSearchParams needs a Suspense boundary or the static build of /history fails.
export default function HistoryPage() {
  return (
    <Suspense fallback={null}>
      <RequireAuth>
        <HistoryContent />
      </RequireAuth>
    </Suspense>
  );
}

function HistoryContent() {
  const { t, language } = useTranslation();
  const [entries, setEntries] = useState<CallHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<OwnedRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const roomFilter = useSearchParams().get('roomId');

  // Corre solo al montar: `t` se omite a propósito de las dependencias para
  // no repetir el fetch del historial cada vez que cambia el idioma.
  useEffect(() => {
    setLoading(true);
    getCallHistory()
      .then(setEntries)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t('No se pudo obtener el historial'));
      })
      .finally(() => setLoading(false));

    setRoomsLoading(true);
    getOwnedRooms()
      .then(setRooms)
      .catch((err) => {
        setRoomsError(err instanceof ApiError ? err.message : t('No se pudieron cargar tus salas'));
      })
      .finally(() => setRoomsLoading(false));
  }, []);

  function formatDate(iso: string): string {
    const locale = language === 'en' ? 'en-US' : 'es-AR';
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  }

  const visibleEntries = roomFilter
    ? entries.filter((entry) => entry.roomId === roomFilter)
    : entries;
  const filteredRoomName = visibleEntries[0]?.roomName;
  const visibleRooms = roomFilter ? rooms.filter((room) => room.id === roomFilter) : rooms;

  return (
    <AppShell>
      <div className={styles.card}>
        <h1>{t('Historial')}</h1>

        <section aria-label={t('Salas que administrás')} className={styles.roomsSection}>
          <h2>{t('Salas que administrás')}</h2>
          {roomsLoading && <p>{t('Cargando salas…')}</p>}
          {roomsError && (
            <p role="alert" className={styles.error}>
              {roomsError}
            </p>
          )}
          {!roomsLoading && !roomsError && visibleRooms.length === 0 && !roomFilter && (
            <p>{t('Todavía no tenés salas como administrador.')}</p>
          )}
          {visibleRooms.length > 0 && (
            <ul className={styles.list}>
              {visibleRooms.map((room) => (
                <li key={room.id} className={styles.entry}>
                  <div className={styles.entryMain}>
                    <strong>{room.name}</strong>
                    <span className={styles.code}>{room.code}</span>
                  </div>
                  <div className={styles.entryMeta}>
                    {room.isJoinable ? (
                      <Link href={`/room/${room.code}`} className={styles.sessionLink}>
                        {t('Entrar')}
                      </Link>
                    ) : (
                      <span className={styles.date}>{t('Vencida')}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {loading && <p>{t('Cargando historial…')}</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {roomFilter && !loading && !error && (
          <p className={styles.filter}>
            {filteredRoomName
              ? `${t('Mostrando solo las llamadas de')} ${filteredRoomName}.`
              : t('Esta sala todavía no tiene llamadas.')}{' '}
            <Link href="/history">{t('Ver todo el historial')}</Link>
          </p>
        )}

        {!roomFilter && !loading && !error && entries.length === 0 && (
          <p>{t('Todavía no hiciste ninguna llamada.')}</p>
        )}

        {!loading && visibleEntries.length > 0 && (
          <ul className={styles.list}>
            {visibleEntries.map((entry, index) => (
              <li key={`${entry.roomId}-${entry.startedAt}-${index}`} className={styles.entry}>
                <div className={styles.entryMain}>
                  <strong>{entry.roomName}</strong>
                  <span className={styles.code}>{entry.roomCode}</span>
                </div>
                <div className={styles.entryMeta}>
                  <span className={styles.date}>{formatDate(entry.startedAt)}</span>
                  {/* Sin sessionId: el intento nunca llegó a materializarse
                      en una sesión (falló, o nadie llegó a conectar del
                      todo) — la fila sigue ahí para no perder de cuál
                      llamada era, simplemente sin botón al gráfico. */}
                  {entry.sessionId && (
                    <Link href={`/history/${entry.sessionId}`} className={styles.sessionLink}>
                      {t('Ver gráfico de interacción')}
                    </Link>
                  )}
                  {entry.sessionId && (
                    <Link
                      href={`/history/${entry.sessionId}#transcript`}
                      className={styles.sessionLink}
                    >
                      {t('Ver transcripción')}
                    </Link>
                  )}
                  {/* Las notas son por sala, no por sesión: a diferencia del
                      gráfico de arriba, este botón sale siempre. La ruta
                      identifica la sala por roomId (D4-C: el code puede
                      haber sido reciclado a otra sala desde esta llamada);
                      roomCode viaja como query param, solo para la clave
                      de notas personales de este dispositivo. */}
                  <Link
                    href={`/history/notes/${entry.roomId}?code=${encodeURIComponent(entry.roomCode)}`}
                    className={styles.sessionLink}
                  >
                    {t('Obtener notas')}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
