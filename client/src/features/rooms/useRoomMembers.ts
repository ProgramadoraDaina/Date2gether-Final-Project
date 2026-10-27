import { useCallback, useEffect, useState } from 'react';
import { ApiError, getRoomMembers, joinRoom, updateMemberRole, type RoomMember } from '@/lib/api';
import { getCurrentUser, isLoggedIn } from '@/lib/auth';

// Un ApiError ya trae un mensaje pensado para mostrarse; cualquier otro
// error (red caída, etc.) usa el texto genérico de cada caso.
function describeError(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function useRoomMembers(code: string | undefined) {
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetchMembers = useCallback(async () => {
    if (!code || !isLoggedIn()) return;
    try {
      setMembers(await getRoomMembers(code));
      setError(null);
    } catch (err) {
      setError(describeError(err, 'No se pudieron cargar los roles de la sala'));
    }
  }, [code]);

  useEffect(() => {
    if (!code || !isLoggedIn()) return;
    let cancelled = false;

    async function loadRoomMembers(roomCode: string) {
      const user = await getCurrentUser();
      if (cancelled) return;
      setCurrentUserId(user?.id ?? null);

      try {
        // El chat de invitados no registra al usuario en la sala; esto sí.
        await joinRoom(roomCode);
      } catch (err) {
        if (!cancelled) setError(describeError(err, 'No se pudieron cargar los roles de la sala'));
        return;
      }
      if (!cancelled) await refetchMembers();
    }

    loadRoomMembers(code);
    return () => {
      cancelled = true;
    };
  }, [code, refetchMembers]);

  async function changeRole(userId: string, role: 'colaborador' | 'participante') {
    if (!code) return;
    try {
      await updateMemberRole(code, userId, role);
    } catch (err) {
      setError(describeError(err, 'No se pudo cambiar el rol'));
      return;
    }
    await refetchMembers();
  }

  const isCurrentUserAdmin = members.some(
    (member) => member.userId === currentUserId && member.role === 'administrador',
  );

  return { members, isCurrentUserAdmin, error, changeRole, refetchMembers };
}
