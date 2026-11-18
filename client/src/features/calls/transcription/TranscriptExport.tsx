'use client';

import { useState } from 'react';
import type { TranscriptEntry } from '@/lib/transcripts';
import { useTranslation } from '../../translation/useTranslation';
import {
  downloadTranscriptPdf,
  downloadTranscriptTxt,
  transcriptFileName,
} from './transcriptFiles';
import styles from './TranscriptDialog.module.css';

interface TranscriptExportProps {
  roomCode: string;
  lines: TranscriptEntry[];
}

export function TranscriptExport({ roomCode, lines }: TranscriptExportProps) {
  const { t } = useTranslation();
  const [pdfFailed, setPdfFailed] = useState(false);
  const title = `${t('Transcripción de la llamada')} · ${roomCode}`;

  return (
    <div className={styles.exportActions}>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          downloadTranscriptTxt(transcriptFileName(roomCode, lines, 'txt'), title, lines)
        }
      >
        {t('Descargar TXT')}
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          downloadTranscriptPdf(transcriptFileName(roomCode, lines, 'pdf'), title, lines).then(
            () => setPdfFailed(false),
            () => setPdfFailed(true),
          )
        }
      >
        {t('Descargar PDF')}
      </button>
      {pdfFailed && (
        <span className={styles.error} role="alert">
          {t('No se pudo generar el PDF')}
        </span>
      )}
    </div>
  );
}
