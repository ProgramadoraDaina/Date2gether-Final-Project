import type { Avatar } from '@/features/avatar/catalog';
import type { TranscriptEntry } from './transcripts';
import {
  extractErrorMessage,
  getAccessToken,
  refreshAccessToken,
  type AuthUser,
  type UserRole,
} from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface Room {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isPermanent: boolean;
  createdAt: string;
}

export interface RoomAccess {
  token: string;
  participant: { sub: string; roomId: string; roomCode: string; name: string; userId?: string };
}

export interface ChatMessage {
  id: string;
  authorName: string;
  kind: 'text' | 'gif';
  content: string;
  createdAt: string;
}

export interface ChatHistoryPage {
  entries: ChatMessage[];
  nextCursor: string | null;
}

export async function getRoomMessages(
  code: string,
  token: string,
  query: URLSearchParams,
  signal: AbortSignal,
): Promise<ChatHistoryPage> {
  const res = await fetch(`${API_URL}/rooms/${encodeURIComponent(code)}/messages?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok)
    throw new ApiError(await extractErrorMessage(res, 'No se pudieron cargar los mensajes'));
  return res.json();
}

export async function getRoomInfo(code: string): Promise<Room> {
  const res = await fetch(`${API_URL}/rooms/${encodeURIComponent(code)}`);
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se encontró la sala'));
  return (await res.json()) as Room;
}

// El nombre se confirma antes de obtener acceso, tanto con cuenta como sin ella.
export async function requestRoomAccess(
  code: string,
  name: string,
): Promise<RoomAccess | WaitingRoomReceipt> {
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

export interface RoomNotes {
  roomId: string;
  content: string;
  revision: number;
  updatedAt: string;
}

export class RoomNotesConflictError extends Error {}

export async function getRoomNotes(code: string, token: string): Promise<RoomNotes> {
  const res = await fetch(`${API_URL}/rooms/${encodeURIComponent(code)}/notes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw new ApiError(await extractErrorMessage(res, 'No se pudieron cargar las notas'));
  return res.json();
}

export async function saveRoomNotes(
  code: string,
  token: string,
  content: string,
  revision: number,
  keepalive = false,
): Promise<RoomNotes> {
  const res = await fetch(`${API_URL}/rooms/${encodeURIComponent(code)}/notes`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content, revision }),
    keepalive,
  });
  if (res.status === 409)
    throw new RoomNotesConflictError('Otra persona actualizó las notas de la sala');
  if (!res.ok)
    throw new ApiError(await extractErrorMessage(res, 'No se pudieron guardar las notas'));
  return res.json();
}

// Para ver desde el historial, no desde una sala en vivo: no hace falta un
// token de acceso de sala (ya venció), el JWT de cuenta alcanza porque el
// backend valida ahí mismo que el usuario tenga historial en esa sala.
// Por roomId, no por roomCode (D4-C): el código puede haber sido reciclado
// a otra sala distinta desde que se guardó esta fila de historial.
export async function getRoomNotesFromHistory(roomId: string): Promise<RoomNotes> {
  const res = await authFetch(`/calls/history/${encodeURIComponent(roomId)}/notes`);
  if (!res.ok)
    throw new ApiError(await extractErrorMessage(res, 'No se pudieron cargar las notas'));
  return res.json();
}

export type RoomRole = 'administrador' | 'colaborador' | 'participante';

export interface RoomMember {
  userId: string;
  name: string;
  role: RoomRole;
  isOwner: boolean;
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

export interface CreateScheduleSlot {
  dayOfWeek: number;
  timeOfDay: string;
  timezone: string;
}

export async function createRoom(
  name: string,
  options?: { isPermanent?: boolean; slots?: CreateScheduleSlot[] },
): Promise<Room> {
  const res = await authFetch('/rooms', {
    method: 'POST',
    body: JSON.stringify({ name, ...options }),
  });
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
  role: RoomRole,
): Promise<void> {
  const res = await authFetch(`/rooms/${code}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo cambiar el rol'));
}

export async function renameRoom(code: string, name: string): Promise<void> {
  const res = await authFetch(`/rooms/${code}/name`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo renombrar la sala'));
}

// Borra la sala (204). Solo su administrador; el backend responde 403/404 si no corresponde.
export async function deleteRoom(code: string): Promise<void> {
  const res = await authFetch(`/rooms/${encodeURIComponent(code)}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res, 'No se pudo eliminar la sala'), res.status);
  }
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  const res = await authFetch('/admin/users');
  if (!res.ok) {
    throw new ApiError(
      await extractErrorMessage(res, 'No se pudieron cargar los usuarios'),
      res.status,
    );
  }
  return res.json();
}

export async function updateAdminUserRole(id: string, role: UserRole): Promise<AdminUser> {
  const res = await authFetch(`/admin/users/${id}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res, 'No se pudo cambiar el rol'), res.status);
  }
  return res.json();
}

export interface CallHistoryEntry {
  id: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  startedAt: string;
  sessionId: string | null;
}

export interface CallHistoryPage {
  entries: CallHistoryEntry[];
  nextCursor: string | null;
  hasArchived: boolean;
}

// Solo cuentas: no hay historial para invitados (no hay endpoint para ellos).
export async function getCallHistory(
  view: 'recent' | 'archive',
  roomId: string | null,
  before: string | null,
  signal?: AbortSignal,
): Promise<CallHistoryPage> {
  const query = new URLSearchParams({ view });
  if (roomId) query.set('roomId', roomId);
  if (before) query.set('before', before);
  const res = await authFetch(`/calls/history?${query}`, { signal });
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res, 'No se pudo obtener el historial'));
  }
  return res.json();
}

export async function clearCallHistoryArchive(): Promise<void> {
  const res = await authFetch('/calls/history/archive', { method: 'DELETE' });
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res, 'No se pudo borrar el historial anterior'));
  }
}

export async function getRoomCallArchive(
  roomId: string,
  before: string | null,
  signal: AbortSignal,
): Promise<CallHistoryPage> {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  const res = await authFetch(`/calls/rooms/${encodeURIComponent(roomId)}/archive${query}`, {
    signal,
  });
  if (!res.ok)
    throw new ApiError(await extractErrorMessage(res, 'No se pudo obtener el historial'));
  return res.json();
}

export async function clearRoomArchive(roomId: string): Promise<void> {
  const res = await authFetch(`/rooms/${encodeURIComponent(roomId)}/archive`, { method: 'DELETE' });
  if (!res.ok)
    throw new ApiError(await extractErrorMessage(res, 'No se pudo borrar el archivo de la sala'));
}

export interface OwnedRoomSlot {
  dayOfWeek: number;
  timeOfDay: string;
  timezone: string;
}

export interface OwnedRoom {
  id: string;
  code: string;
  name: string;
  isPermanent: boolean;
  hiddenFromMyRooms: boolean;
  isJoinable: boolean;
  createdAt: string;
  lastEnteredAt: string;
  slots: OwnedRoomSlot[];
  nextOccurrenceAt: string | null;
}

export async function getOwnedRooms(): Promise<OwnedRoom[]> {
  const res = await authFetch('/rooms/mine');
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res, 'No se pudieron cargar tus salas'));
  }
  return res.json();
}

export async function setMyRoomVisibility(roomId: string, hidden: boolean): Promise<void> {
  const res = await authFetch(`/rooms/mine/${encodeURIComponent(roomId)}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ hidden }),
  });
  if (!res.ok)
    throw new ApiError(await extractErrorMessage(res, 'No se pudo actualizar tu lista de salas'));
}

export interface CallSessionSummary {
  id: string;
  roomCode: string;
  roomName: string | null;
  startedAt: string;
  endedAt: string | null;
  participantCount: number;
}

export type TrackIntervalSource = 'camera' | 'microphone' | 'screen_share';

export interface TrackInterval {
  source: TrackIntervalSource;
  startedAt: string;
  endedAt: string;
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
  trackIntervals: TrackInterval[];
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

export async function updateAvatar(avatar: Avatar): Promise<AuthUser> {
  const res = await authFetch('/auth/me/avatar', {
    method: 'PATCH',
    body: JSON.stringify(avatar),
  });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo guardar el avatar'));
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
  if (!res.ok)
    throw new ApiError(await extractErrorMessage(res, 'No se pudieron cargar los sonidos'));
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

export async function updateRoomEmoji(
  code: string,
  id: string,
  form: FormData,
): Promise<RoomEmoji> {
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

export interface WaitingRoomReceipt {
  status: 'pending';
  requestId: string;
  ticket: string;
}
export type AdmissionStatus =
  | { status: 'admitted'; access: RoomAccess }
  | { status: 'pending' | 'rejected' | 'cancelled' | 'expired'; blocked?: boolean };
export interface AdmissionManagement {
  waitingRoomEnabled: boolean;
  entryLocked: boolean;
  // Necesario para OCULTAR (no solo deshabilitar) el toggle de sala de
  // espera: la spec prohíbe que el admin pueda intentar desactivarla.
  isPermanent: boolean;
  requests: {
    id: string;
    name: string;
    registered: boolean;
    createdAt: string;
    // D5: solicitud sin TTL (sala permanente) creada hace más de 24h -- señal
    // de solo lectura para la lista del admin, no afecta si es decidible.
    stale: boolean;
  }[];
}
const admissionPath = (code: string) => '/rooms/' + encodeURIComponent(code) + '/admission';

export async function getAdmissionStatus(
  code: string,
  receipt: WaitingRoomReceipt,
  signal?: AbortSignal,
): Promise<AdmissionStatus> {
  const res = await fetch(
    API_URL + admissionPath(code) + '/' + encodeURIComponent(receipt.requestId) + '/status',
    {
      headers: { Authorization: 'Bearer ' + receipt.ticket },
      signal,
    },
  );
  if (res.status === 401 || res.status === 404) return { status: 'expired' };
  if (!res.ok)
    throw new ApiError(
      await extractErrorMessage(res, 'No se pudo consultar la solicitud. Reintentando…'),
    );
  return res.json();
}

export async function cancelAdmissionRequest(
  code: string,
  receipt: WaitingRoomReceipt,
): Promise<void> {
  const res = await fetch(
    API_URL + admissionPath(code) + '/' + encodeURIComponent(receipt.requestId) + '/cancel',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + receipt.ticket },
    },
  );
  if (res.status === 401 || res.status === 404) return;
  if (!res.ok)
    throw new ApiError(
      await extractErrorMessage(res, 'No se pudo cancelar. Reintentá la cancelación.'),
    );
}

export async function getRoomAdmission(
  code: string,
  signal?: AbortSignal,
): Promise<AdmissionManagement> {
  const res = await authFetch(admissionPath(code), { signal });
  if (!res.ok)
    throw new ApiError(await extractErrorMessage(res, 'No se pudieron cargar las solicitudes'));
  return res.json();
}

export async function updateRoomAdmission(
  code: string,
  settings: Partial<Pick<AdmissionManagement, 'waitingRoomEnabled' | 'entryLocked'>>,
) {
  const res = await authFetch(admissionPath(code), {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
  if (!res.ok)
    throw new ApiError(await extractErrorMessage(res, 'No se pudo actualizar la admisión'));
  return res.json();
}

export async function decideAdmission(
  code: string,
  requestId: string,
  decision: 'admitted' | 'rejected',
) {
  const res = await authFetch(admissionPath(code) + '/' + encodeURIComponent(requestId), {
    method: 'PATCH',
    body: JSON.stringify({ decision }),
  });
  if (!res.ok)
    throw new ApiError(await extractErrorMessage(res, 'No se pudo actualizar la admisión'));
  return res.json();
}

const schedulePath = (code: string) => '/rooms/' + encodeURIComponent(code) + '/schedule';

// Público, como la sala de espera: la respuesta nunca lleva la timezone del
// owner, solo el instante UTC ya resuelto por el servidor (design.md D6).
export async function getNextScheduleOccurrence(
  code: string,
): Promise<{ nextOccurrenceAt: string | null }> {
  const res = await fetch(`${API_URL}${schedulePath(code)}/next`);
  if (!res.ok)
    throw new ApiError(await extractErrorMessage(res, 'No se pudo consultar el horario'));
  return res.json();
}

export interface ScheduleSlot extends CreateScheduleSlot {
  id: string;
  roomId: string;
  createdAt: string;
}

// Admin-only: a diferencia de /next, esta sí incluye la timezone.
export async function getScheduleSlots(code: string): Promise<ScheduleSlot[]> {
  const res = await authFetch(`${schedulePath(code)}/slots`);
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo cargar el horario'));
  return res.json();
}

export async function createScheduleSlot(
  code: string,
  slot: CreateScheduleSlot,
): Promise<ScheduleSlot> {
  const res = await authFetch(`${schedulePath(code)}/slots`, {
    method: 'POST',
    body: JSON.stringify(slot),
  });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo agregar el horario'));
  return res.json();
}

export async function deleteScheduleSlot(code: string, slotId: string): Promise<void> {
  const res = await authFetch(`${schedulePath(code)}/slots/${encodeURIComponent(slotId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new ApiError(await extractErrorMessage(res, 'No se pudo borrar el horario'));
}

// Acta de una sesión del historial: mismo 404 que la línea de tiempo si no participaste.
export async function getSessionTranscript(sessionId: string): Promise<TranscriptEntry[]> {
  const res = await authFetch(`/calls/sessions/${encodeURIComponent(sessionId)}/transcript`);
  if (!res.ok) {
    throw new ApiError(
      await extractErrorMessage(res, 'No se pudo cargar la transcripción'),
      res.status,
    );
  }
  return res.json();
}

// La sesión del historial recién existe cuando la llamada termina para todos.
export async function resolveCallSessionBySid(livekitRoomSid: string): Promise<{ id: string }> {
  const res = await authFetch(`/calls/sessions/by-sid/${encodeURIComponent(livekitRoomSid)}`);
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res, 'No se encontró la sesión'), res.status);
  }
  return res.json();
}
