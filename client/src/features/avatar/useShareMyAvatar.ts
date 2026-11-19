'use client';

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { getCurrentUser, isLoggedIn } from '@/lib/auth';
import { toAvatar } from './catalog';
import { useAvatarStore } from './store';

// Manda mi avatar a la sala al unirme (roomUsers confirma el join) y cada vez que lo cambio.
export function useShareMyAvatar(socket: Socket | null) {
  const avatar = useAvatarStore((s) => s.avatar);
  // Una cuenta en un dispositivo nuevo no debe pisar su avatar guardado con el vacío local.
  const [synced, setSynced] = useState(() => !isLoggedIn());

  useEffect(() => {
    if (synced) return;
    let cancelled = false;
    getCurrentUser()
      .then((user) => {
        const saved = toAvatar(user?.avatar);
        if (!cancelled && saved) useAvatarStore.getState().setAvatar(saved);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSynced(true);
      });
    return () => {
      cancelled = true;
    };
  }, [synced]);

  useEffect(() => {
    if (!socket || !synced) return;
    const send = () => socket.emit('setAvatar', useAvatarStore.getState().avatar);
    socket.on('roomUsers', send);
    return () => {
      socket.off('roomUsers', send);
    };
  }, [socket, synced]);

  useEffect(() => {
    if (socket?.connected && synced) socket.emit('setAvatar', avatar);
  }, [socket, synced, avatar]);
}
