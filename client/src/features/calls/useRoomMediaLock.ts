'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { MEDIA_LOCK_EVENTS, type MediaLockState, type SetMediaLockPayload } from '@date2gether/shared';

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
    socket.on(MEDIA_LOCK_EVENTS.state, onMediaLockState);
    return () => {
      socket.off(MEDIA_LOCK_EVENTS.state, onMediaLockState);
    };
  }, [socket]);

  const setAudioLock = useCallback(
    (locked: boolean) =>
      socket?.emit(MEDIA_LOCK_EVENTS.set, { target: 'audio', locked } satisfies SetMediaLockPayload),
    [socket],
  );
  const setVideoLock = useCallback(
    (locked: boolean) =>
      socket?.emit(MEDIA_LOCK_EVENTS.set, { target: 'video', locked } satisfies SetMediaLockPayload),
    [socket],
  );

  return { ...state, setAudioLock, setVideoLock };
}
