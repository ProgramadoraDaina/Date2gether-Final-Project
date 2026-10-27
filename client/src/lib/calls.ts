import { extractErrorMessage } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface CallSession {
  url: string;
  token: string;
  roomName: string;
  participantLimit: number;
}

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
  if (!res.ok) throw new Error(await extractErrorMessage(res, 'No se pudo iniciar la llamada'));
  return res.json();
}
