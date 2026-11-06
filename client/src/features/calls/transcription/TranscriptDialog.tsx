'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getTranscript, type TranscriptEntry } from '@/lib/transcripts';
import { useTranslation } from '../../translation/useTranslation';
import styles from './TranscriptDialog.module.css';

interface TranscriptDialogProps {
  open: boolean;
  onClose: () => void;
  roomCode: string;
  roomToken: string;
  callSid: string;
  callEnded: boolean;
}

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; lines: TranscriptEntry[] };

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

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
    getTranscript(roomCode, roomToken, callSid, request.signal).then(
      (lines) => setState({ status: 'ready', lines }),
      () => !request.signal.aborted && setState({ status: 'error' }),
    );
    return () => {
      request.abort();
      setState({ status: 'loading' });
    };
  }, [open, roomCode, roomToken, callSid]);

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
      <div className={styles.body}>
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
            {t('Todavía no hay frases. Activá los subtítulos y hablá con el micrófono prendido.')}
          </p>
        )}
        {state.status === 'ready' && state.lines.length > 0 && (
          <ol className={styles.lines}>
            {state.lines.map((line) => (
              <li key={line.id} className={styles.line}>
                <time className={styles.time} dateTime={line.spokenAt}>
                  {formatTime(line.spokenAt)}
                </time>
                <span className={styles.speaker}>{line.speakerName}</span>
                <span>{line.content}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {callEnded && (
        <div className={styles.footer}>
          <Link href="/" className={styles.homeLink}>
            {t('Volver al inicio')}
          </Link>
        </div>
      )}
    </dialog>
  );
}
