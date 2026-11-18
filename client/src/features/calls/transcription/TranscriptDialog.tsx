'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { isLoggedIn } from '@/lib/auth';
import { getTranscript, type TranscriptEntry } from '@/lib/transcripts';
import { useTranslation } from '../../translation/useTranslation';
import { TranscriptExport } from './TranscriptExport';
import { TranscriptLines } from './TranscriptLines';
import styles from './TranscriptDialog.module.css';

interface TranscriptDialogProps {
  open: boolean;
  onClose: () => void;
  roomCode: string;
  roomToken: string;
  callSid: string;
  callEnded: boolean;
}

const REFRESH_MS = 3000;

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; lines: TranscriptEntry[] };

export function TranscriptDialog({
  open,
  onClose,
  roomCode,
  roomToken,
  callSid,
  callEnded,
}: TranscriptDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      getTranscript(roomCode, roomToken, callSid, request.signal)
        .then(
          (lines) => setState({ status: 'ready', lines }),
          // A failed refresh keeps the lines already shown; only the first load reports it.
          () =>
            !request.signal.aborted &&
            setState((prev) => (prev.status === 'ready' ? prev : { status: 'error' })),
        )
        .finally(() => {
          if (!callEnded && !request.signal.aborted) timer = setTimeout(load, REFRESH_MS);
        });
    };
    load();
    return () => {
      request.abort();
      clearTimeout(timer);
      setState({ status: 'loading' });
    };
  }, [open, roomCode, roomToken, callSid, callEnded]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const lineCount = state.status === 'ready' ? state.lines.length : 0;
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || lineCount === 0) return;
    // Follow new lines only when the reader was already at the bottom.
    if (body.scrollHeight - body.scrollTop - body.clientHeight < 80)
      body.scrollTop = body.scrollHeight;
  }, [lineCount]);

  const hasLines = state.status === 'ready' && state.lines.length > 0;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="transcript-title"
      // Un click en el backdrop llega con el propio <dialog> como target: se cierra al tocar afuera.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.header}>
        <h2 id="transcript-title">{t('Transcripción de la llamada')}</h2>
        {state.status === 'ready' && (
          <span className={styles.counter}>
            {state.lines.length} {t('frases')}
          </span>
        )}
        <button type="button" className={styles.close} onClick={onClose} aria-label={t('Cerrar')}>
          ✕
        </button>
      </div>
      <div className={styles.body} ref={bodyRef}>
        {state.status === 'loading' && (
          <p className={styles.muted}>{t('Cargando transcripción…')}</p>
        )}
        {state.status === 'error' && (
          <p className={styles.error} role="alert">
            {t('No se pudo cargar la transcripción')}
          </p>
        )}
        {state.status === 'ready' && state.lines.length === 0 && (
          <p className={styles.muted}>
            {t(
              'Todavía no hay frases. Se agregan solas mientras alguien habla con el micrófono prendido.',
            )}
          </p>
        )}
        {state.status === 'ready' && state.lines.length > 0 && (
          <TranscriptLines lines={state.lines} />
        )}
      </div>
      {(hasLines || callEnded) && (
        <div className={styles.footer}>
          {hasLines && <TranscriptExport roomCode={roomCode} lines={state.lines} />}
          {callEnded && (
            <div className={styles.endLinks}>
              {isLoggedIn() && (
                <Link
                  href={`/history/call/${encodeURIComponent(callSid)}`}
                  className={styles.homeLink}
                >
                  {t('Ver en el historial')}
                </Link>
              )}
              <Link href="/" className={styles.homeLink}>
                {t('Volver al inicio')}
              </Link>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
