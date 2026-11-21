'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { NAME_FOCUS_EVENTS, type NameFocusState } from '@date2gether/shared';

interface UseNameFocusSettingResult extends NameFocusState {
  setEnabled(enabled: boolean): void;
}

export function useNameFocusSetting(socket: Socket | null): UseNameFocusSettingResult {
  const [state, setState] = useState<NameFocusState>({ enabled: false });

  // Mismo patrón que useRoomMediaLock: sync al unirse/reconectar, y el
  // estado en vivo cuando el admin prende o apaga el enfoque automático.
  useEffect(() => {
    if (!socket) return;
    function onNameFocusState(next: NameFocusState) {
      setState(next);
    }
    socket.on(NAME_FOCUS_EVENTS.state, onNameFocusState);
    return () => {
      socket.off(NAME_FOCUS_EVENTS.state, onNameFocusState);
    };
  }, [socket]);

  const setEnabled = useCallback(
    (enabled: boolean) => socket?.emit(NAME_FOCUS_EVENTS.set, { enabled } satisfies NameFocusState),
    [socket],
  );

  return { ...state, setEnabled };
}
