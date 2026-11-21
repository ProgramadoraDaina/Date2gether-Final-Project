'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';

export interface MediaLockState {
  audioLocked: boolean;
  videoLocked: boolean;
}

interface UseRoomMediaLockResult extends MediaLockState {
  setAudioLock(locked: boolean): void;
  setVideoLock(locked: boolean): void;
}

export function useRoomMediaLock(socket: Socket | null): UseRoomMediaLockResult {
  const [state, setState] = useState<MediaLockState>({ audioLocked: false, videoLocked: false });

  // Sync al unirse/reconectar, y también el estado en vivo cuando el admin
  // activa o desactiva un lock (mismo patrón de musicState/eventState en el
  // gateway: ver chat.gateway.ts).
  useEffect(() => {
    if (!socket) return;
    function onMediaLockState(next: MediaLockState) {
      setState(next);
    }
    socket.on('mediaLockState', onMediaLockState);
    return () => {
      socket.off('mediaLockState', onMediaLockState);
    };
  }, [socket]);

  const setAudioLock = useCallback(
    (locked: boolean) => socket?.emit('setMediaLock', { target: 'audio', locked }),
    [socket],
  );
  const setVideoLock = useCallback(
    (locked: boolean) => socket?.emit('setMediaLock', { target: 'video', locked }),
    [socket],
  );

  return { ...state, setAudioLock, setVideoLock };
}
