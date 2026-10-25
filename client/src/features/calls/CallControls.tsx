'use client';

import type { CallSessionState } from './useCallSession';

interface CallControlsProps {
  roomCode: string;
  session: CallSessionState;
}

export function CallControls({ roomCode, session }: CallControlsProps) {
  const { status, error, joinCall, leaveCall } = session;

  if (status === 'connecting') {
    return <div className="call-controls">Conectando...</div>;
  }

  if (status === 'in-call') {
    return (
      <div className="call-controls">
        <button type="button" onClick={leaveCall}>
          Colgar
        </button>
      </div>
    );
  }

  return (
    <div className="call-controls">
      {error && <p className="call-error">{error}</p>}
      <button type="button" onClick={() => joinCall(roomCode)}>
        Llamar
      </button>
    </div>
  );
}
