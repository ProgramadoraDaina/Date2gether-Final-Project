'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ApiError, getCallSessionTimeline, type CallSessionTimeline } from '@/lib/api';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import { ParticipationTimeline } from '@/features/calls/ParticipationTimeline';
import { SessionTranscript } from '@/features/calls/transcription/SessionTranscript';
import styles from './page.module.css';

export default function CallSessionTimelinePage() {
  return (
    <RequireAuth>
      <CallSessionTimelineContent />
    </RequireAuth>
  );
}

function CallSessionTimelineContent() {
  const { t, language } = useTranslation();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [timeline, setTimeline] = useState<CallSessionTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Corre al montar y si cambia `sessionId` (navegación entre dos sesiones
  // sin desmontar la página); `t` se omite a propósito, mismo criterio que
  // history/page.tsx.
  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setError(null);
    getCallSessionTimeline(sessionId)
      .then(setTimeline)
      .catch((err) => {
        // El backend devuelve 404 (no 403) tanto si la sesión no existe como
        // si el solicitante no participó de ella (mismo criterio en ambos
        // casos, ver design.md "Lectura y autorización"): se distingue por
        // status, no por el texto del mensaje, para no mostrar un error
        // genérico donde corresponde un mensaje claro.
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          return;
        }
        setError(
          err instanceof ApiError ? err.message : t('No se pudo obtener la línea de tiempo'),
        );
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  function formatDate(iso: string): string {
    const locale = language === 'en' ? 'en-US' : 'es-AR';
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  }

  if (notFound) {
    return (
      <AppShell>
        <div className={styles.card}>
          <h1>{t('Línea de tiempo')}</h1>
          <p>{t('No encontramos esta sesión, o no participaste de ella.')}</p>
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
        <div className={styles.titleRow}>
          <h1>{timeline?.roomName ?? t('Línea de tiempo')}</h1>
          {timeline?.endedAt && (
            <span className={styles.statusPill}>
              <span className={styles.statusDot} />
              {t('Finalizada')}
            </span>
          )}
        </div>

        {loading && <p>{t('Cargando línea de tiempo…')}</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {!loading && !error && timeline && (
          <>
            <p className={styles.sessionMeta}>{formatDate(timeline.startedAt)}</p>
            <ParticipationTimeline
              participants={timeline.participants}
              startedAt={timeline.startedAt}
              endedAt={timeline.endedAt}
            />
            <SessionTranscript sessionId={sessionId} roomCode={timeline.roomCode} />
          </>
        )}
      </div>
    </AppShell>
  );
}
