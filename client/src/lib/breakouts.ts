import { extractErrorDetails } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type LeavePolicy = 'locked' | 'free_return';
// Decisión 3 (design.md "joinPolicy: esquema, migración y autorización"):
// separado de LeavePolicy -- gobierna el movimiento HACIA DENTRO por
// iniciativa propia, nunca la vuelta a la principal.
export type JoinPolicy = 'admin_only' | 'open';

export interface BreakoutRoomOccupant {
  livekitIdentity: string;
  displayName: string;
  userId: string | null;
}

// Forma devuelta por createBreakoutRoom/updateBreakoutRoomPolicy -- esas
// dos rutas siguen siendo admin-only por construcción (el backend ya
// rechaza con 403 a cualquier otro rol), así que no necesitan la
// proyección discriminada por rol de Decisión 4 (esa es exclusiva de
// listBreakoutRooms).
export interface BreakoutRoom {
  id: string;
  livekitRoomName: string;
  label: string;
  leavePolicy: LeavePolicy;
  joinPolicy: JoinPolicy;
  autoCloseAt: string | null;
  occupants: BreakoutRoomOccupant[];
}

// Decisión 4 (design.md "Proyección de list por rol", tasks.md 5.5): forma
// discriminada que devuelve listBreakoutRooms -- mismo contrato que
// BreakoutRoomAdminView/BreakoutRoomPublicView del backend.
export interface BreakoutRoomAdminOccupant {
  livekitIdentity: string;
  // Única clave que permite calcular "quién quedó en la sala principal":
  // breakoutParticipants (presencia de socket) menos la unión de
  // sourceIdentity de todos los occupants (ver BreakoutHostConsole).
  sourceIdentity: string;
  displayName: string;
  userId: string | null;
}

export interface BreakoutRoomAdminView {
  id: string;
  livekitRoomName: string;
  label: string;
  leavePolicy: LeavePolicy;
  joinPolicy: JoinPolicy;
  autoCloseAt: string | null;
  occupants: BreakoutRoomAdminOccupant[];
}

export interface BreakoutRoomPublicView {
  id: string;
  label: string;
  leavePolicy: LeavePolicy;
  joinPolicy: JoinPolicy;
  autoCloseAt: string | null;
  occupantCount: number;
  selfAssigned: boolean;
}

// Discrimina sin depender de un campo de rol explícito: solo la vista de
// admin trae `occupants` (D11, mismo criterio que el backend -- la vista
// pública nunca incluye esa clave, ni siquiera vacía).
export function isAdminBreakoutView(
  room: BreakoutRoomAdminView | BreakoutRoomPublicView,
): room is BreakoutRoomAdminView {
  return 'occupants' in room;
}

export interface CreateBreakoutRoomInput {
  label?: string;
  leavePolicy?: LeavePolicy;
  joinPolicy?: JoinPolicy;
  autoCloseInMinutes?: number;
}

export interface UpdateBreakoutRoomInput {
  leavePolicy?: LeavePolicy;
  joinPolicy?: JoinPolicy;
  autoCloseInMinutes?: number;
}

export interface BreakoutToken {
  url: string;
  token: string;
  roomName: string;
  participantLimit: number;
}

// Mensaje propio del cliente para el enforcement de `locked` (D8, design.md):
// se mapea por el código BREAKOUT_RETURN_LOCKED, nunca por el texto del
// backend, mismo precedente que NO_HOST_CONNECTED_MESSAGE en calls.ts.
const BREAKOUT_RETURN_LOCKED_MESSAGE = 'El host te va a devolver a la sala principal.';

// Decisión 2 (design.md "Señal de motivo de remoción"): mapeo
// endReason->copia para que useCallSession.endedForBreakout()/
// removedByPolicy() tengan un mensaje propio y específico que
// renderizar -- nunca un código crudo visible, mismo criterio que
// BREAKOUT_RETURN_LOCKED_MESSAGE arriba. `breakout-locked` reutiliza el
// mismo texto que returnFromBreakoutRoom ya usa para el mismo código
// (BREAKOUT_RETURN_LOCKED): es la misma política, explicada en el mismo
// idioma sin importar por qué camino llegó la expulsión.
const BREAKOUT_END_REASON_COPY = {
  'breakout-closed': 'El host te devolvió a la sala principal.',
  'breakout-locked': BREAKOUT_RETURN_LOCKED_MESSAGE,
} as const;

export function resolveBreakoutEndCopy(endReason: keyof typeof BREAKOUT_END_REASON_COPY): string {
  return BREAKOUT_END_REASON_COPY[endReason];
}

function authHeaders(roomToken: string): HeadersInit {
  return { Authorization: `Bearer ${roomToken}` };
}

function jsonHeaders(roomToken: string): HeadersInit {
  return { ...authHeaders(roomToken), 'Content-Type': 'application/json' };
}

export async function createBreakoutRoom(
  roomCode: string,
  roomToken: string,
  input: CreateBreakoutRoomInput = {},
): Promise<BreakoutRoom> {
  const res = await fetch(`${API_URL}/calls/${encodeURIComponent(roomCode)}/breakouts`, {
    method: 'POST',
    headers: jsonHeaders(roomToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { message } = await extractErrorDetails(res, 'No se pudo crear la mini sala');
    throw new Error(message);
  }
  return res.json();
}

export async function listBreakoutRooms(
  roomCode: string,
  roomToken: string,
): Promise<BreakoutRoomAdminView[] | BreakoutRoomPublicView[]> {
  const res = await fetch(`${API_URL}/calls/${encodeURIComponent(roomCode)}/breakouts`, {
    headers: authHeaders(roomToken),
  });
  if (!res.ok) {
    const { message } = await extractErrorDetails(res, 'No se pudieron cargar las mini salas');
    throw new Error(message);
  }
  return res.json();
}

export async function updateBreakoutRoomPolicy(
  roomCode: string,
  roomToken: string,
  breakoutId: string,
  input: UpdateBreakoutRoomInput,
): Promise<BreakoutRoom> {
  const res = await fetch(
    `${API_URL}/calls/${encodeURIComponent(roomCode)}/breakouts/${encodeURIComponent(breakoutId)}`,
    {
      method: 'PATCH',
      headers: jsonHeaders(roomToken),
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) {
    const { message } = await extractErrorDetails(res, 'No se pudo actualizar la mini sala');
    throw new Error(message);
  }
  return res.json();
}

export async function moveToBreakoutRoom(
  roomCode: string,
  roomToken: string,
  breakoutId: string,
  livekitIdentity: string,
): Promise<{ targetIdentity: string }> {
  const res = await fetch(
    `${API_URL}/calls/${encodeURIComponent(roomCode)}/breakouts/${encodeURIComponent(breakoutId)}/participants`,
    {
      method: 'POST',
      headers: jsonHeaders(roomToken),
      body: JSON.stringify({ livekitIdentity }),
    },
  );
  if (!res.ok) {
    const { message } = await extractErrorDetails(res, 'No se pudo trasladar al participante');
    throw new Error(message);
  }
  return res.json();
}

export async function issueBreakoutToken(
  roomCode: string,
  roomToken: string,
  breakoutId: string,
): Promise<BreakoutToken> {
  const res = await fetch(
    `${API_URL}/calls/${encodeURIComponent(roomCode)}/breakouts/${encodeURIComponent(breakoutId)}/token`,
    {
      method: 'POST',
      headers: authHeaders(roomToken),
    },
  );
  if (!res.ok) {
    const { message } = await extractErrorDetails(
      res,
      'No se pudo obtener el acceso a la mini sala',
    );
    throw new Error(message);
  }
  return res.json();
}

// `livekitIdentity` solo lo manda un administrador que devuelve a OTRO
// ocupante (ver return-occupant.dto.ts); un ocupante que vuelve por cuenta
// propia manda el body vacío.
export async function returnFromBreakoutRoom(
  roomCode: string,
  roomToken: string,
  breakoutId: string,
  livekitIdentity?: string,
): Promise<void> {
  const res = await fetch(
    `${API_URL}/calls/${encodeURIComponent(roomCode)}/breakouts/${encodeURIComponent(breakoutId)}/return`,
    {
      method: 'POST',
      headers: jsonHeaders(roomToken),
      body: JSON.stringify(livekitIdentity ? { livekitIdentity } : {}),
    },
  );
  if (!res.ok) {
    const { message, code } = await extractErrorDetails(
      res,
      'No se pudo volver a la sala principal',
    );
    if (code === 'BREAKOUT_RETURN_LOCKED') throw new Error(BREAKOUT_RETURN_LOCKED_MESSAGE);
    throw new Error(message);
  }
}

export async function closeBreakoutRoom(
  roomCode: string,
  roomToken: string,
  breakoutId: string,
): Promise<void> {
  const res = await fetch(
    `${API_URL}/calls/${encodeURIComponent(roomCode)}/breakouts/${encodeURIComponent(breakoutId)}`,
    {
      method: 'DELETE',
      headers: authHeaders(roomToken),
    },
  );
  if (!res.ok) {
    const { message } = await extractErrorDetails(res, 'No se pudo cerrar la mini sala');
    throw new Error(message);
  }
}

export async function closeAllBreakoutRooms(roomCode: string, roomToken: string): Promise<void> {
  const res = await fetch(`${API_URL}/calls/${encodeURIComponent(roomCode)}/breakouts`, {
    method: 'DELETE',
    headers: authHeaders(roomToken),
  });
  if (!res.ok) {
    const { message } = await extractErrorDetails(res, 'No se pudieron cerrar las mini salas');
    throw new Error(message);
  }
}

export async function recallBreakoutRooms(
  roomCode: string,
  roomToken: string,
  input: { breakoutIds?: string[]; inSeconds: number },
): Promise<{ closesAt: string }> {
  const res = await fetch(`${API_URL}/calls/${encodeURIComponent(roomCode)}/breakouts/recall`, {
    method: 'POST',
    headers: jsonHeaders(roomToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const { message } = await extractErrorDetails(
      res,
      'No se pudo llamar de vuelta a las mini salas',
    );
    throw new Error(message);
  }
  return res.json();
}
