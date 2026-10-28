'use client';

import type { CallSessionState } from './useCallSession';
import { useTranslation } from '../translation/useTranslation';
import styles from './CallControls.module.css';

interface CallControlsProps {
  roomCode: string;
  roomToken: string;
  session: CallSessionState;
}

export function CallControls({ roomCode, roomToken, session }: CallControlsProps) {
  const { t } = useTranslation();
  if (session.status === 'idle' || session.status === 'in-call') return null;
  if (session.status === 'connecting') {
    return (
      <div className={styles.callControls}>
        {t('Conectando...')}{' '}
        <button type="button" onClick={session.leaveCall}>
          {t('Cancelar')}
        </button>
      </div>
    );
  }
  // status === 'error': el auto-join solo se dispara una vez al entrar a la
  // sala, así que si falla el usuario necesita un botón para reintentar sin
  // tener que recargar la página.
  return (
    <div className={styles.callControls}>
      {session.error && (
        <p className={styles.callError} role="alert">
          {t(session.error)}
        </p>
      )}
      <button type="button" onClick={() => session.joinCall(roomCode, roomToken)}>
        {t('Reintentar')}
      </button>
    </div>
  );
}
