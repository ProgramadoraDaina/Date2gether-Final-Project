'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, resolveCallSessionBySid } from '@/lib/api';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import styles from '../../[sessionId]/page.module.css';

type State = 'resolving' | 'pending' | 'error';

export default function CallTranscriptLinkPage() {
  return (
    <RequireAuth>
      <CallTranscriptLinkContent />
    </RequireAuth>
  );
}

function CallTranscriptLinkContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const routerRef = useRef(router);
  const { sid } = useParams<{ sid: string }>();
  const [state, setState] = useState<State>('resolving');

  const lookup = useCallback(() => {
    resolveCallSessionBySid(sid).then(
      ({ id }) => routerRef.current.replace(`/history/${id}`),
      (err) => setState(err instanceof ApiError && err.status === 404 ? 'pending' : 'error'),
    );
  }, [sid]);

  useEffect(() => {
    lookup();
  }, [lookup]);

  return (
    <AppShell>
      <div className={styles.card}>
        <h1>{t('Transcripción')}</h1>
        {state === 'resolving' && <p>{t('Buscando la llamada en tu historial…')}</p>}
        {state === 'pending' && (
          <>
            <p>
              {t(
                'Todavía no está en tu historial: aparece cuando la llamada termina para todas las personas.',
              )}
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setState('resolving');
                lookup();
              }}
            >
              {t('Volver a intentar')}
            </button>
          </>
        )}
        {state === 'error' && (
          <p className={styles.error} role="alert">
            {t('No se pudo cargar la transcripción')}
          </p>
        )}
        <p>
          <Link href="/history">{t('Volver al historial')}</Link>
        </p>
      </div>
    </AppShell>
  );
}
