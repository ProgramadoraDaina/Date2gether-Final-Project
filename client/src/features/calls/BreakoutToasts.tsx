'use client';

import { useEffect } from 'react';
import { useTranslation } from '../translation/useTranslation';
import type { BreakoutToast } from '../chat/useRoomSocket';
import styles from './BreakoutToasts.module.css';

const TOAST_MS = 6000;

function joinNames(names: string[], and: string): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`;
}

function ArrowIcon({ direction }: { direction: 'in' | 'out' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {direction === 'out' ? (
        <path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" />
      ) : (
        <path d="M14 8H3M7 4L3 8l4 4" stroke="currentColor" strokeWidth="1.6" fill="none" />
      )}
    </svg>
  );
}

function PresenceToast({
  toast,
  onDismiss,
}: {
  toast: BreakoutToast;
  onDismiss: (id: number) => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const moved = toast.kind === 'moved';
  const plural = toast.names.length > 1;
  const action = moved
    ? `${t(plural ? 'se fueron a' : 'se fue a')} ${toast.label}`
    : t(plural ? 'volvieron a la sala principal' : 'volvió a la sala principal');

  return (
    <li className={`${styles.toast} ${moved ? styles.moved : styles.returned}`} role="status">
      <span className={styles.icon}>
        <ArrowIcon direction={moved ? 'out' : 'in'} />
      </span>
      <div className={styles.body}>
        <span className={styles.kicker}>
          {moved ? t('Mini sala') : `${t('Desde')} ${toast.label}`}
        </span>
        <span className={styles.message}>
          <strong>{joinNames(toast.names, t('y'))}</strong> {action}
        </span>
      </div>
      <button
        type="button"
        className={styles.close}
        aria-label={t('Cerrar aviso')}
        onClick={() => onDismiss(toast.id)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      <span className={styles.drain} aria-hidden="true" />
    </li>
  );
}

export function BreakoutToasts({
  toasts,
  onDismiss,
}: {
  toasts: BreakoutToast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <ul className={styles.stack} aria-live="polite">
      {toasts.slice(-4).map((toast) => (
        <PresenceToast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </ul>
  );
}
