'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ApiError, getCallSessionTimeline, type CallSessionTimeline } from '@/lib/api';
import { useSessionStatus } from '@/lib/useSessionStatus';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import { ParticipationTimeline } from '@/features/calls/ParticipationTimeline';
import styles from './page.module.css';

export default function CallSessionTimelinePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const loggedIn = useSessionStatus();
  return (
    <SessionTimeline key={sessionId + ':' + loggedIn} sessionId={sessionId} loggedIn={loggedIn} />
  );
}

function SessionTimeline({ sessionId, loggedIn }: { sessionId: string; loggedIn: boolean | null }) {
  const { t, language } = useTranslation();
  const [timeline, setTimeline] = useState<CallSessionTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La clave del componente reinicia los datos al navegar entre sesiones.
  // Los errores se traducen al mostrarlos, sin repetir consultas por idioma.
  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    getCallSessionTimeline(sessionId)
      .then((next) => {
        if (!cancelled) setTimeline(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // El 404 cubre tanto sesiones inexistentes como sesiones ajenas.
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          return;
        }
        setError(err instanceof ApiError ? err.message : 'No se pudo obtener la línea de tiempo');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, loggedIn]);

  function formatDate(iso: string): string {
    const locale = language === 'en' ? 'en-US' : 'es-AR';
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  }

  if (loggedIn === null) return null;

  if (!loggedIn) {
    return (
      <AppShell>
        <div className={styles.card}>
          <h1>{t('Línea de tiempo')}</h1>
          <p>{t('Necesitás iniciar sesión para ver esta línea de tiempo.')}</p>
          <p>
            <Link href="/login">{t('Iniciar sesión')}</Link> ·{' '}
            <Link href="/register">{t('Crear cuenta')}</Link>
          </p>
        </div>
      </AppShell>
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
            {t(error)}
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
          </>
        )}
      </div>
    </AppShell>
  );
}
