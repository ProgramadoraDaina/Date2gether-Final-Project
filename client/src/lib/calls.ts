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

// LiveKit no manda webhook de mute/unmute: después de la primera publicación,
// prender/apagar cámara o mic solo mutea el track ya publicado (ver
// aggregate-session.ts). Esto es lo que completa esa foto para la línea de
// tiempo — se llama "en el fondo" cada vez que cambia el estado real del
// track, sin bloquear ni mostrarle un error a quien está en la llamada: es
// un reporte secundario, no algo de lo que dependa poder hablar o verse.
export async function reportTrackState(
  roomCode: string,
  roomToken: string,
  source: 'camera' | 'microphone',
  enabled: boolean,
): Promise<void> {
  try {
    await fetch(`${API_URL}/calls/${encodeURIComponent(roomCode)}/track-state`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${roomToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source, enabled }),
    });
  } catch {
    // Best-effort: si falla, la llamada sigue — solo se pierde ese tramo de
    // la línea de tiempo, nunca la videollamada en sí.
  }
}
