import { extractErrorMessage, getAccessToken, refreshAccessToken } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface Room {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface RoomAccess {
  token: string;
  participant: { sub: string; roomCode: string; name: string; userId?: string };
}

// El nombre se confirma antes de obtener acceso, tanto con cuenta como sin ella.
export async function requestRoomAccess(code: string, name: string): Promise<RoomAccess> {
  const path = `/rooms/${encodeURIComponent(code)}/access`;
  const init = { method: 'POST', body: JSON.stringify({ name }) };
  const res = getAccessToken()
    ? await authFetch(path, init)
    : await fetch(`${API_URL}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo entrar a la sala'));
  return res.json();
}

export type RoomRole = 'administrador' | 'colaborador' | 'participante';

export interface RoomMember {
  userId: string;
  name: string;
  role: RoomRole;
}

// Errores pensados para mostrarse tal cual al usuario (sesión vencida, validación
// del backend, etc.). Un error que NO es ApiError es algo inesperado (red caída,
// backend abajo): la UI lo distingue para no mostrar un mensaje crudo de fetch.
export class ApiError extends Error {}

function withAuth(token: string, init: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  };
}

// Agrega el token a todo pedido autenticado y, si el backend responde 401,
// refresca una vez y reintenta — el mismo criterio que ya usa getCurrentUser().
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = getAccessToken();
  if (!accessToken) throw new ApiError('Necesitás iniciar sesión');

  const res = await fetch(`${API_URL}${path}`, withAuth(accessToken, init));
  if (res.status !== 401) return res;

  const refreshedToken = await refreshAccessToken();
  if (!refreshedToken) throw new ApiError('Tu sesión venció o cerraste sesión en otra pestaña');
  return fetch(`${API_URL}${path}`, withAuth(refreshedToken, init));
}

export async function createRoom(name: string): Promise<Room> {
  const res = await authFetch('/rooms', { method: 'POST', body: JSON.stringify({ name }) });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo crear la reunión'));
  return res.json();
}

// Idempotente: si ya sos miembro de la sala, el backend no hace nada.
export async function joinRoom(code: string): Promise<void> {
  const res = await authFetch(`/rooms/${code}/join`, { method: 'POST' });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo unir a la sala'));
}

export async function getRoomMembers(code: string): Promise<RoomMember[]> {
  const res = await authFetch(`/rooms/${code}/members`);
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res, 'No se pudo obtener la lista de miembros'));
  }
  return res.json();
}

export async function updateMemberRole(
  code: string,
  userId: string,
  role: 'colaborador' | 'participante',
): Promise<void> {
  const res = await authFetch(`/rooms/${code}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo cambiar el rol'));
}
