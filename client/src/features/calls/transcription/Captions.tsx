'use client';

import { useTranslation } from '../../translation/useTranslation';
import type { SpeechRecognitionError } from './useSpeechRecognition';
import { useTranscription } from './useTranscription';
import styles from './Captions.module.css';

const ERROR_MESSAGES: Record<SpeechRecognitionError, string> = {
  'not-allowed': 'El navegador no dio permiso para transcribir tu micrófono.',
  network: 'Se cortó la conexión con el servicio de subtítulos del navegador.',
  unknown: 'Los subtítulos dejaron de funcionar. Probá desactivarlos y activarlos de nuevo.',
};

function CaptionsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="5" width="20" height="14" rx="1" />
      <path d="M10 10.5a2 2 0 1 0 0 3" />
      <path d="M17 10.5a2 2 0 1 0 0 3" />
    </svg>
  );
}

export function CaptionsButton({
  buttonClassName,
  activeClassName,
}: {
  buttonClassName: string;
  activeClassName: string;
}) {
  const { t } = useTranslation();
  const { supported, enabled, toggle } = useTranscription();
  const label = !supported
    ? t('Tu navegador no tiene subtítulos en vivo. Probá con Chrome o Edge.')
    : enabled
      ? t('Desactivar subtítulos')
      : t('Activar subtítulos');
  return (
    <button
      type="button"
      className={`${buttonClassName} ${enabled ? activeClassName : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      disabled={!supported}
      onClick={toggle}
    >
      <CaptionsIcon />
    </button>
  );
}

export function CaptionsOverlay() {
  const { t } = useTranslation();
  const { enabled, captions, error, saveFailed } = useTranscription();
  if (!enabled) return null;
  return (
    <div className={styles.captions} aria-live="polite">
      {error && (
        <p className={styles.error} role="alert">
          {t(ERROR_MESSAGES[error])}
        </p>
      )}
      {saveFailed && (
        <p className={styles.error} role="alert">
          {t('No se pudieron guardar tus últimas frases en la transcripción.')}
        </p>
      )}
      {captions.map((caption) => (
        <p key={caption.identity} className={styles.line}>
          <span className={styles.speaker}>{caption.name}</span>
          <span className={caption.final ? undefined : styles.interim}>{caption.text}</span>
        </p>
      ))}
    </div>
  );
}
