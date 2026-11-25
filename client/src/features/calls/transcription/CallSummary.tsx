'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, generateCallSummary, getCallSummary, type CallSummary as Summary } from '@/lib/api';
import { useTranslation } from '../../translation/useTranslation';
import styles from './TranscriptDialog.module.css';

// Maps the HTTP status to a translated message: the backend text is never shown as-is.
function errorKey(error: unknown): string {
  const status = error instanceof ApiError ? error.status : undefined;
  switch (status) {
    case 429:
      // Only the provider quota carries a code; any other 429 is our own rate limit.
      return error instanceof ApiError && error.code === 'AI_QUOTA'
        ? 'Se alcanzó el límite de uso de la IA. Probá de nuevo más tarde.'
        : 'Demasiadas solicitudes. Probá de nuevo en un minuto.';
    case 503:
      return 'El resumen con IA no está disponible por ahora. Probá de nuevo más tarde.';
    case 422:
      return 'Esta llamada no tiene transcripción para resumir.';
    case 413:
      return 'La transcripción es demasiado larga para resumirla con IA.';
    default:
      return 'No se pudo generar el resumen';
  }
}

export function CallSummary({
  sessionId,
  hasTranscript,
}: {
  sessionId: string;
  hasTranscript: boolean;
}) {
  const { t, language } = useTranslation();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks the session currently shown, so a late response for another one is ignored.
  const currentSession = useRef(sessionId);
  const generating = useRef(false);

  useEffect(() => {
    currentSession.current = sessionId;
    generating.current = false;
    setSummary(null);
    setError(null);
    setLoading(false);
    if (!hasTranscript) return;
    let active = true;
    // A failed lookup just falls back to offering the button.
    getCallSummary(sessionId).then(
      (stored) => active && setSummary(stored),
      () => undefined,
    );
    return () => {
      active = false;
      // Unmounted or switched session: nothing in flight may write into the next one.
      currentSession.current = '';
    };
  }, [sessionId, hasTranscript]);

  if (!hasTranscript) return null;

  async function summarize() {
    // The ref blocks a second click before React re-renders the disabled button.
    if (generating.current) return;
    generating.current = true;
    setLoading(true);
    setError(null);
    const isCurrent = () => currentSession.current === sessionId;
    try {
      const generated = await generateCallSummary(sessionId, language);
      if (isCurrent()) setSummary(generated);
    } catch (err) {
      if (isCurrent()) setError(errorKey(err));
    } finally {
      if (isCurrent()) {
        generating.current = false;
        setLoading(false);
      }
    }
  }

  return (
    <div className={styles.summary}>
      <h3 className={styles.summaryTitle}>{t('Resumen con IA')}</h3>
      {summary ? (
        <>
          <p className={styles.summaryText}>{summary.text}</p>
          {summary.language !== language && (
            <p className={styles.muted}>
              {t(summary.language === 'en' ? 'Resumen generado en inglés.' : 'Resumen generado en español.')}
            </p>
          )}
          <p className={styles.muted}>{t('Generado con IA: puede contener errores.')}</p>
        </>
      ) : (
        <button type="button" className="secondary" disabled={loading} onClick={summarize}>
          {loading ? t('Generando resumen…') : t('Resumir con IA')}
        </button>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
