import { extractErrorMessage, getAccessToken, refreshAccessToken, type AuthUser } from './auth';

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
// `status` es opcional: lo usan los puntos de llamada que necesitan distinguir
// un caso puntual (p. ej. 404 de "sesión inexistente o ajena" en la línea de
// tiempo de llamadas) sin acoplarse al texto del mensaje.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function withAuth(token: string, init: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      // Con FormData el navegador arma su propio Content-Type con el boundary.
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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

export interface CallHistoryEntry {
  roomCode: string;
  roomName: string;
  startedAt: string;
}

// Solo cuentas: no hay historial para invitados (no hay endpoint para ellos).
export async function getCallHistory(): Promise<CallHistoryEntry[]> {
  const res = await authFetch('/calls/history');
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res, 'No se pudo obtener el historial'));
  }
  return res.json();
}

export interface CallSessionSummary {
  id: string;
  roomCode: string;
  roomName: string | null;
  startedAt: string;
  endedAt: string | null;
  participantCount: number;
}

export interface CallSessionParticipantSummary {
  participantKey: string;
  userId: string | null;
  displayName: string;
  isGuest: boolean;
  firstJoinedAt: string;
  lastLeftAt: string | null;
  totalSeconds: number;
  spoke: boolean;
  screenShared: boolean;
  rejoinCount: number;
  nameColor: string | null;
}

export interface CallSessionTimeline {
  id: string;
  roomCode: string;
  roomName: string | null;
  startedAt: string;
  endedAt: string | null;
  participants: CallSessionParticipantSummary[];
}

// Solo las sesiones de llamada donde el solicitante participó (GET /calls/sessions).
export async function getCallSessions(): Promise<CallSessionSummary[]> {
  const res = await authFetch('/calls/sessions');
  if (!res.ok) {
    throw new ApiError(
      await extractErrorMessage(res, 'No se pudieron obtener las sesiones de llamada'),
      res.status,
    );
  }
  return res.json();
}

// El backend devuelve 404 (no 403) tanto si la sesión no existe como si el
// solicitante no participó de ella — misma rama en el servidor, a propósito,
// para no filtrar si una sesión ajena existe. El status se propaga en el
// ApiError para que la UI distinga ese caso de un error inesperado.
export async function getCallSessionTimeline(sessionId: string): Promise<CallSessionTimeline> {
  const res = await authFetch(`/calls/sessions/${encodeURIComponent(sessionId)}/timeline`);
  if (!res.ok) {
    throw new ApiError(
      await extractErrorMessage(res, 'No se pudo obtener la línea de tiempo'),
      res.status,
    );
  }
  return res.json();
}

export async function updateNameColor(nameColor: string): Promise<AuthUser> {
  const res = await authFetch('/auth/me/color', {
    method: 'PATCH',
    body: JSON.stringify({ nameColor }),
  });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo guardar el color'));
  return res.json();
}

export interface RoomEmoji {
  id: string;
  name: string;
  // 'sound': sonido de sala sin imagen; solo se usa desde la botonera, nunca en chat ni reacciones.
  kind: 'emoji' | 'sound';
  // Emoji Unicode elegido del picker; null si el emoji de la sala es una imagen subida.
  emoji: string | null;
  hasSound: boolean;
  // Crédito del sonido cuando viene de Freesound (requerido por la licencia CC BY).
  soundAttribution: string | null;
  callMode: 'reaction' | 'sticker';
  sticker: StickerOptions;
  version: number;
}

export const STICKER_DURATIONS = [5, 10, 30] as const;
export const STICKER_POSITIONS = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const;
export const STICKER_SIZES = ['small', 'medium', 'large'] as const;
export const STICKER_ANIMATIONS = ['static', 'float', 'spin', 'pulse', 'shake'] as const;

export interface StickerOptions {
  duration: (typeof STICKER_DURATIONS)[number];
  position: (typeof STICKER_POSITIONS)[number];
  size: (typeof STICKER_SIZES)[number];
  animation: (typeof STICKER_ANIMATIONS)[number];
}

export interface FreesoundSound {
  id: number;
  name: string;
  username: string;
  license: string;
  duration: number;
  previewUrl: string;
}

export async function searchFreesound(code: string, query: string): Promise<FreesoundSound[]> {
  const params = new URLSearchParams({ q: query });
  const res = await authFetch(`/rooms/${encodeURIComponent(code)}/emojis/sounds?${params}`);
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudieron cargar los sonidos'));
  return res.json();
}

// `?v=` cambia al editar: el backend cachea los archivos como inmutables.
export function roomEmojiImageUrl(code: string, emoji: Pick<RoomEmoji, 'id' | 'version'>): string {
  return `${API_URL}/rooms/${encodeURIComponent(code)}/emojis/${emoji.id}/image?v=${emoji.version}`;
}

export function roomEmojiSoundUrl(code: string, emoji: Pick<RoomEmoji, 'id' | 'version'>): string {
  return `${API_URL}/rooms/${encodeURIComponent(code)}/emojis/${emoji.id}/sound?v=${emoji.version}`;
}

// Público: también lo usan los invitados para reaccionar con los emojis de la sala.
export async function getRoomEmojis(code: string): Promise<RoomEmoji[]> {
  const res = await fetch(`${API_URL}/rooms/${encodeURIComponent(code)}/emojis`);
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res, 'No se pudieron cargar los emojis'));
  }
  return res.json();
}

export async function createRoomEmoji(code: string, form: FormData): Promise<RoomEmoji> {
  const res = await authFetch(`/rooms/${encodeURIComponent(code)}/emojis`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo agregar el emoji'));
  return res.json();
}

export async function updateRoomEmoji(code: string, id: string, form: FormData): Promise<RoomEmoji> {
  const res = await authFetch(`/rooms/${encodeURIComponent(code)}/emojis/${id}`, {
    method: 'PATCH',
    body: form,
  });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo guardar el emoji'));
  return res.json();
}

export async function deleteRoomEmoji(code: string, id: string): Promise<void> {
  const res = await authFetch(`/rooms/${encodeURIComponent(code)}/emojis/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo borrar el emoji'));
}
