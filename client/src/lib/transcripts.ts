import { extractErrorMessage } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface TranscriptEntry {
  id: string;
  speakerName: string;
  content: string;
  spokenAt: string;
}

export async function saveTranscriptLine(
  roomCode: string,
  roomToken: string,
  callSid: string,
  content: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/transcripts/${encodeURIComponent(roomCode)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${roomToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ callSid, content }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, 'No se pudo guardar la frase'));
}

export async function getTranscript(
  roomCode: string,
  roomToken: string,
  callSid: string,
  signal?: AbortSignal,
): Promise<TranscriptEntry[]> {
  const params = new URLSearchParams({ callSid });
  const res = await fetch(`${API_URL}/transcripts/${encodeURIComponent(roomCode)}?${params}`, {
    headers: { Authorization: `Bearer ${roomToken}` },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok)
    throw new Error(await extractErrorMessage(res, 'No se pudo cargar la transcripción'));
  return res.json();
}
