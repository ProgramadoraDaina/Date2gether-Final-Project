'use client';

import type { CallSessionState } from './useCallSession';
import { useTranslation } from '../translation/useTranslation';

interface CallControlsProps {
  roomCode: string;
  roomToken: string;
  session: CallSessionState;
}

export function CallControls({ roomCode, roomToken, session }: CallControlsProps) {
  const { t } = useTranslation();
  if (session.status === 'in-call') return null;
  if (session.status === 'connecting') {
    return (
      <div className="call-controls">
        {t('Conectando...')}{' '}
        <button type="button" onClick={session.leaveCall}>
          {t('Cancelar')}
        </button>
      </div>
    );
  }
  return (
    <div className="call-controls">
      {session.error && (
        <p className="call-error" role="alert">
          {t(session.error)}
        </p>
      )}
      <button type="button" onClick={() => session.joinCall(roomCode, roomToken)}>
        {t('Llamar')}
      </button>
    </div>
  );
}
