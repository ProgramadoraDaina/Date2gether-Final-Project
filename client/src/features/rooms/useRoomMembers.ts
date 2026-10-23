import { useEffect, useState } from 'react';
import { getRoomMembers, joinRoom, updateMemberRole, type RoomMember } from '@/lib/api';
import { getCurrentUser, isLoggedIn } from '@/lib/auth';

export function useRoomMembers(code: string | undefined) {
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        const roomMembers = await getRoomMembers(roomCode);
        if (!cancelled) setMembers(roomMembers);
      } catch {
        if (!cancelled) setError('No se pudieron cargar los roles de la sala');
      }
    }

    loadRoomMembers(code);
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function changeRole(userId: string, role: 'colaborador' | 'participante') {
    if (!code) return;
    try {
      await updateMemberRole(code, userId, role);
      setMembers(await getRoomMembers(code));
      setError(null);
    } catch {
      setError('No se pudo cambiar el rol');
    }
  }

  const isCurrentUserAdmin = members.some(
    (member) => member.userId === currentUserId && member.role === 'administrador',
  );

  return { members, isCurrentUserAdmin, error, changeRole };
}
