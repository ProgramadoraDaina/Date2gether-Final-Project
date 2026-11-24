'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ApiError, getRoomNotesFromHistory, type RoomNotes } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import styles from './page.module.css';

// Mismo formato de clave que RoomPage (ver personalNotesKey ahí): las notas
// personales nunca viajan al backend, viven solo en este dispositivo, y
// siguen guardándose con el `code` de la sala (RoomPage no conoce otra
// cosa) -- D4-C solo cambia la clave de AUTORIZACIÓN (roomId), no esta.
// El historial es exclusivo de cuentas, así que la identidad siempre es el
// userId -- nunca el fallback de invitado que usa esa otra función.
function personalNotesKey(roomCode: string, userId: string): string {
  return `date2gether:notes:${roomCode}:${userId}`;
}

export default function RoomNotesFromHistoryPage() {
  return (
    <RequireAuth>
      <RoomNotesFromHistoryContent />
    </RequireAuth>
  );
}

function RoomNotesFromHistoryContent() {
  const { t } = useTranslation();
  const { roomId } = useParams<{ roomId: string }>();
  // roomCode viaja como query param, no como parte de la ruta (D4-C): la
  // ruta identifica la sala por id; el code es solo la clave de notas
  // personales, y ya es display-only en CallHistoryEntry.
  const roomCode = useSearchParams().get('code');
  const [personalNotes, setPersonalNotes] = useState<string | null>(null);
  const [roomNotes, setRoomNotes] = useState<RoomNotes | null>(null);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setForbidden(false);
    setError(null);
    Promise.all([
      getCurrentUser().then((user) =>
        setPersonalNotes(
          user && roomCode ? localStorage.getItem(personalNotesKey(roomCode, user.id)) : '',
        ),
      ),
      getRoomNotesFromHistory(roomId)
        .then(setRoomNotes)
        .catch((err) => {
          if (err instanceof ApiError && err.status === 403) {
            setForbidden(true);
            return;
          }
          setError(err instanceof ApiError ? err.message : t('No se pudieron cargar las notas'));
        }),
    ]).finally(() => setLoading(false));
  }, [roomId, roomCode]);

  if (forbidden) {
    return (
      <AppShell>
        <div className={styles.card}>
          <h1>{t('Notas')}</h1>
          <p>{t('No encontramos historial en esta sala, o no participaste de ella.')}</p>
          <p>
            <Link href="/history">{t('Volver al historial')}</Link>
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className={styles.card}>
        <Link href="/history" className={styles.backLink}>
          {t('← Volver al historial')}
        </Link>
        <h1>{t('Notas')}</h1>

        {loading && <p>{t('Cargando notas…')}</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {!loading && (
          <>
            <section className={styles.section}>
              <h2>{t('Notas personales')}</h2>
              <p className={styles.hint}>{t('Notas guardadas en este dispositivo')}</p>
              {personalNotes ? (
                <p className={styles.notes}>{personalNotes}</p>
              ) : (
                <p className={styles.empty}>
                  {t('No escribiste notas personales en este dispositivo para esta sala.')}
                </p>
              )}
            </section>

            <section className={styles.section}>
              <h2>{t('Notas compartidas de la sala')}</h2>
              {roomNotes?.content ? (
                <p className={styles.notes}>{roomNotes.content}</p>
              ) : (
                <p className={styles.empty}>{t('Esta sala no tiene notas compartidas.')}</p>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
