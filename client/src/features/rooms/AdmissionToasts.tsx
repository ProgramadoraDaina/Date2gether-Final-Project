'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { AdmissionManagement } from '@/lib/api';
import { useTranslation } from '../translation/useTranslation';
import styles from './AdmissionToasts.module.css';

const MAX_VISIBLE = 3;

type AdmissionRequest = AdmissionManagement['requests'][number];

interface AdmissionToastsProps {
  requests: AdmissionRequest[];
  busy: boolean;
  onDecide: (requestId: string, decision: 'admitted' | 'rejected') => void;
  onOpenAll: () => void;
}

// Aviso estilo Meet/Teams: el admin decide sin abrir el panel de ingresos.
export function AdmissionToasts({ requests, busy, onDecide, onOpenAll }: AdmissionToastsProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const pending = requests.filter((request) => !dismissed.has(request.id));
  if (pending.length === 0) return null;
  const visible = pending.slice(0, MAX_VISIBLE);
  const hidden = pending.length - visible.length;

  return createPortal(
    <section className={styles.stack} aria-label={t('Solicitudes para entrar')} aria-live="polite">
      {visible.map((request) => (
        <article key={request.id} className={styles.toast}>
          <div className={styles.body}>
            <span className={styles.kicker}>
              {t(request.registered ? 'Cuenta registrada' : 'Invitado')}
            </span>
            <span className={styles.message}>
              <strong>{request.name}</strong> {t('quiere entrar a la sala')}
            </span>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.admit}
              disabled={busy}
              aria-label={`${t('Admitir')} ${request.name}`}
              onClick={() => onDecide(request.id, 'admitted')}
            >
              {t('Admitir')}
            </button>
            <button
              type="button"
              className={styles.reject}
              disabled={busy}
              aria-label={`${t('Rechazar')} ${request.name}`}
              onClick={() => onDecide(request.id, 'rejected')}
            >
              {t('Rechazar')}
            </button>
            <button
              type="button"
              className={styles.later}
              aria-label={`${t('Decidir más tarde')} ${request.name}`}
              title={t('Decidir más tarde')}
              onClick={() => setDismissed(new Set(dismissed).add(request.id))}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </button>
          </div>
        </article>
      ))}
      {hidden > 0 && (
        <button type="button" className={styles.more} onClick={onOpenAll}>
          {`+${hidden} ${t('esperando')} · ${t('Ver todas')}`}
        </button>
      )}
    </section>,
    document.body,
  );
}
