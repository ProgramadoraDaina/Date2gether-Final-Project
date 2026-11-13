'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ApiError,
  getCallHistory,
  getCallSessions,
  type CallHistoryEntry,
  type CallSessionSummary,
} from '@/lib/api';
import { useSessionStatus } from '@/lib/useSessionStatus';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import styles from './page.module.css';

export default function HistoryPage() {
  const { t, language } = useTranslation();
  const loggedIn = useSessionStatus();
  const [entries, setEntries] = useState<CallHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CallSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  // Se guarda el mensaje original y se traduce al renderizar, sin volver
  // a consultar el historial cuando cambia el idioma.
  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    getCallHistory()
      .then((next) => {
        if (!cancelled) setEntries(next);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof ApiError ? err.message : 'No se pudo obtener el historial');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    getCallSessions()
      .then((next) => {
        if (!cancelled) setSessions(next);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setSessionsError(
            err instanceof ApiError
              ? err.message
              : 'No se pudieron obtener las sesiones de llamada',
          );
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

  function formatDate(iso: string): string {
    const locale = language === 'en' ? 'en-US' : 'es-AR';
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  }

  if (loggedIn === null) return null;

  if (!loggedIn) {
    return (
      <AppShell>
        <div className={styles.card}>
          <h1>{t('Historial')}</h1>
          <p>{t('Necesitás iniciar sesión para ver tu historial de llamadas.')}</p>
          <p>
            <Link href="/login">{t('Iniciar sesión')}</Link> ·{' '}
            <Link href="/register">{t('Crear cuenta')}</Link>
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className={styles.card}>
        <h1>{t('Historial')}</h1>

        {loading && <p>{t('Cargando historial…')}</p>}
        {error && (
          <p className={styles.error} role="alert">
            {t(error)}
          </p>
        )}

        {!loading && !error && entries.length === 0 && (
          <p>{t('Todavía no hiciste ninguna llamada.')}</p>
        )}

        {!loading && entries.length > 0 && (
          <ul className={styles.list}>
            {entries.map((entry, index) => (
              <li key={`${entry.roomCode}-${entry.startedAt}-${index}`} className={styles.entry}>
                <div className={styles.entryMain}>
                  <strong>{entry.roomName}</strong>
                  <span className={styles.code}>{entry.roomCode}</span>
                </div>
                <span className={styles.date}>{formatDate(entry.startedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.card}>
        <h2>{t('Sesiones de llamada')}</h2>

        {sessionsLoading && <p>{t('Cargando sesiones…')}</p>}
        {sessionsError && (
          <p className={styles.error} role="alert">
            {t(sessionsError)}
          </p>
        )}

        {!sessionsLoading && !sessionsError && sessions.length === 0 && (
          <p>{t('Todavía no participaste de ninguna sesión de llamada.')}</p>
        )}

        {!sessionsLoading && sessions.length > 0 && (
          <ul className={styles.list}>
            {sessions.map((session) => (
              <li key={session.id} className={styles.entry}>
                <div className={styles.entryMain}>
                  <strong>{session.roomName ?? session.roomCode}</strong>
                  <span className={styles.code}>{session.roomCode}</span>
                </div>
                <span className={styles.date}>{formatDate(session.startedAt)}</span>
                <Link href={`/history/${session.id}`} className={styles.sessionLink}>
                  {t('Ver línea de tiempo')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
