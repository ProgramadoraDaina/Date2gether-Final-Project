'use client';

import { useEffect } from 'react';
import { useTranslation } from '../translation/useTranslation';
import type { BreakoutToast } from '../chat/useRoomSocket';
import { formatCountdown, useCountdown } from './useCountdown';
import styles from './BreakoutToasts.module.css';

const PRESENCE_TOAST_MS = 6000;

function joinNames(names: string[], and: string): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`;
}

function PresenceToast({
  toast,
  onDismiss,
}: {
  toast: Extract<BreakoutToast, { kind: 'moved' | 'returned' }>;
  onDismiss: (id: number) => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), PRESENCE_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const plural = toast.names.length > 1;
  const verb =
    toast.kind === 'moved'
      ? `${t(plural ? 'se fueron a' : 'se fue a')} ${toast.label}`
      : t(plural ? 'volvieron' : 'volvió');
  const detail = toast.kind === 'moved' ? t('Mini sala') : `${t('Desde')} ${toast.label}`;

  return (
    <li className={styles.toast} role="status">
      <span className={styles.icon} aria-hidden="true">
        {toast.kind === 'moved' ? '→' : '←'}
      </span>
      <div className={styles.body}>
        <span>
          <strong>{joinNames(toast.names, t('y'))}</strong> {verb}
        </span>
        <span className={styles.detail}>{detail}</span>
      </div>
      <div className={styles.drain} aria-hidden="true" />
    </li>
  );
}

function ClosingToast({
  toast,
  onDismiss,
}: {
  toast: Extract<BreakoutToast, { kind: 'closing' }>;
  onDismiss: (id: number) => void;
}) {
  const { t } = useTranslation();
  const left = useCountdown(toast.closesAt);
  useEffect(() => {
    if (left === 0) onDismiss(toast.id);
  }, [left, toast.id, onDismiss]);

  return (
    <li className={styles.toast} role="status">
      <span className={`${styles.icon} ${styles.iconAccent}`} aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14">
          <rect
            x="1"
            y="1"
            width="12"
            height="12"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
          <path d="M7 3.5v3.5l2.5 2" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </span>
      <div className={styles.body}>
        <strong>{t('El anfitrión los llama a la sala principal')}</strong>
        <span className={styles.detail}>
          {t('Vuelven en')} <span className={styles.clock}>{formatCountdown(left ?? 0)}</span>
        </span>
      </div>
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
      {toasts
        .slice(-4)
        .map((toast) =>
          toast.kind === 'closing' ? (
            <ClosingToast key={toast.id} toast={toast} onDismiss={onDismiss} />
          ) : (
            <PresenceToast key={toast.id} toast={toast} onDismiss={onDismiss} />
          ),
        )}
    </ul>
  );
}
