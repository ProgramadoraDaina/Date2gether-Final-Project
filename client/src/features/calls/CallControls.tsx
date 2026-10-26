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
  const { status, error, joinCall, leaveCall } = session;

  if (status === 'connecting') {
    return <div className="call-controls">{t('Conectando...')}</div>;
  }

  if (status === 'in-call') {
    return (
      <div className="call-controls">
        <button type="button" onClick={leaveCall}>
          {t('Colgar')}
        </button>
      </div>
    );
  }

  return (
    <div className="call-controls">
      {error && <p className="call-error">{error}</p>}
      <button type="button" onClick={() => joinCall(roomCode, roomToken)}>
        {t('Llamar')}
      </button>
    </div>
  );
}
