import { extractErrorDetails } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface CallSession {
  url: string;
  token: string;
  roomName: string;
  participantLimit: number;
}

// Mensaje propio del cliente para el gate de anfitrión (D5, design.md): se
// mapea por el código NO_HOST_CONNECTED, nunca por el texto del backend, así
// el cliente no queda acoplado a la redacción exacta del servidor.
const NO_HOST_CONNECTED_MESSAGE = 'Esperá a que se conecte un anfitrión para unirte a la llamada.';

export async function startCall(
  roomCode: string,
  roomToken: string,
  signal?: AbortSignal,
): Promise<CallSession> {
  const res = await fetch(`${API_URL}/calls/${encodeURIComponent(roomCode)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${roomToken}` },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    const { message, code } = await extractErrorDetails(res, 'No se pudo iniciar la llamada');
    if (code === 'NO_HOST_CONNECTED') throw new Error(NO_HOST_CONNECTED_MESSAGE);
    throw new Error(message);
  }
  return res.json();
}
