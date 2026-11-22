import { extractErrorDetails } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type LeavePolicy = 'locked' | 'free_return';

export interface BreakoutRoomOccupant {
  livekitIdentity: string;
  displayName: string;
  userId: string | null;
}

export interface BreakoutRoom {
  id: string;
  livekitRoomName: string;
  label: string;
  leavePolicy: LeavePolicy;
  autoCloseAt: string | null;
  occupants: BreakoutRoomOccupant[];
}

export interface CreateBreakoutRoomInput {
  label?: string;
  leavePolicy?: LeavePolicy;
  autoCloseInMinutes?: number;
}

export interface UpdateBreakoutRoomInput {
  leavePolicy?: LeavePolicy;
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
): Promise<BreakoutRoom[]> {
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
