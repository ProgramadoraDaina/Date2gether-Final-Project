'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, getCallHistory, type CallHistoryEntry } from '@/lib/api';
import { isLoggedIn } from '@/lib/auth';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import styles from './page.module.css';

export default function HistoryPage() {
  const { t, language } = useTranslation();
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [entries, setEntries] = useState<CallHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Corre solo al montar: `t` se omite a propósito de las dependencias para
  // no repetir el fetch del historial cada vez que cambia el idioma.
  useEffect(() => {
    const alreadyLoggedIn = isLoggedIn();
    setLoggedIn(alreadyLoggedIn);
    setChecking(false);
    if (!alreadyLoggedIn) return;

    setLoading(true);
    getCallHistory()
      .then(setEntries)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t('No se pudo obtener el historial'));
        if (!isLoggedIn()) setLoggedIn(false);
      })
      .finally(() => setLoading(false));
  }, []);

  function formatDate(iso: string): string {
    const locale = language === 'en' ? 'en-US' : 'es-AR';
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  }

  if (checking) return null;

  if (!loggedIn) {
    return (
      <AppShell>
        <div className={styles.card}>
          <h1>{t('Historial')}</h1>
          <p>{t('Necesitás iniciar sesión para ver tu historial de llamadas.')}</p>
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
        <h1>{t('Historial')}</h1>

        {loading && <p>{t('Cargando historial…')}</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {!loading && !error && entries.length === 0 && (
          <p>{t('Todavía no hiciste ninguna llamada.')}</p>
        )}

        {!loading && entries.length > 0 && (
          <ul className={styles.list}>
            {entries.map((entry, index) => (
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
