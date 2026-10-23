import { getAccessToken } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface Room {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export type RoomRole = 'administrador' | 'colaborador' | 'participante';

export interface RoomMember {
  userId: string;
  name: string;
  role: RoomRole;
}

function authHeaders(): HeadersInit {
  const accessToken = getAccessToken();
  if (!accessToken) throw new Error('Necesitás iniciar sesión');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
}

export async function createRoom(name: string): Promise<Room> {
  const res = await fetch(`${API_URL}/rooms`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  });
  if (res.status === 401) throw new Error('Tu sesión venció o cerraste sesión en otra pestaña');
  if (!res.ok) throw new Error('No se pudo crear la reunión');
  return res.json();
}

// Idempotente: si ya sos miembro de la sala, el backend no hace nada.
export async function joinRoom(code: string): Promise<void> {
  const res = await fetch(`${API_URL}/rooms/${code}/join`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) throw new Error('No se pudo unir a la sala');
}

export async function getRoomMembers(code: string): Promise<RoomMember[]> {
  const res = await fetch(`${API_URL}/rooms/${code}/members`, { headers: authHeaders() });
  if (!res.ok) throw new Error('No se pudo obtener la lista de miembros');
  return res.json();
}

export async function updateMemberRole(
  code: string,
  userId: string,
  role: 'colaborador' | 'participante',
): Promise<void> {
  const res = await fetch(`${API_URL}/rooms/${code}/members/${userId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error('No se pudo cambiar el rol');
}
