'use client';

import { useEffect, useState } from 'react';
import { getSessionTranscript } from '@/lib/api';
import type { TranscriptEntry } from '@/lib/transcripts';
import { useTranslation } from '../../translation/useTranslation';
import { TranscriptExport } from './TranscriptExport';
import { TranscriptLines } from './TranscriptLines';
import styles from './TranscriptDialog.module.css';

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; lines: TranscriptEntry[] };

export function SessionTranscript({
  sessionId,
  roomCode,
}: {
  sessionId: string;
  roomCode: string;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    getSessionTranscript(sessionId).then(
      (lines) => active && setState({ status: 'ready', lines }),
      () => active && setState({ status: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [sessionId]);

  return (
    <section className={styles.session} aria-labelledby="session-transcript-title">
      <h2 id="session-transcript-title">{t('Transcripción')}</h2>
      {state.status === 'loading' && <p className={styles.muted}>{t('Cargando transcripción…')}</p>}
      {state.status === 'error' && (
        <p className={styles.error} role="alert">
          {t('No se pudo cargar la transcripción')}
        </p>
      )}
      {state.status === 'ready' && state.lines.length === 0 && (
        <p className={styles.muted}>{t('Esta llamada no tiene transcripción.')}</p>
      )}
      {state.status === 'ready' && state.lines.length > 0 && (
        <>
          <TranscriptExport roomCode={roomCode} lines={state.lines} />
          <TranscriptLines lines={state.lines} />
        </>
      )}
    </section>
  );
}
