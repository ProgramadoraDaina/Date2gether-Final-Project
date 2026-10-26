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
  const { status, error, isMuted, toggleMute, joinCall, leaveCall } = session;

  if (status === 'connecting') {
    return (
      <div className="call-controls">
        {t('Conectando...')}
        <button type="button" onClick={leaveCall}>
          {t('Cancelar')}
        </button>
      </div>
    );
  }

  if (status === 'in-call') {
    return (
      <div className="call-controls">
        <button type="button" aria-pressed={isMuted} onClick={toggleMute}>
          {t(isMuted ? 'Activar micrófono' : 'Silenciar micrófono')}
        </button>
        <button type="button" onClick={leaveCall}>
          {t('Colgar')}
        </button>
      </div>
    );
  }

  return (
    <div className="call-controls">
      {error && (
        <p className="call-error" role="alert">
          {t(error)}
        </p>
      )}
      <button type="button" onClick={() => joinCall(roomCode, roomToken)}>
        {t('Llamar')}
      </button>
    </div>
  );
}
