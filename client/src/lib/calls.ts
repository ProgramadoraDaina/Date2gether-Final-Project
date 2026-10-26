import { extractErrorMessage } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface ChimeMeeting {
  MeetingId: string;
  [key: string]: unknown;
}

export interface ChimeAttendee {
  AttendeeId: string;
  ExternalUserId: string;
  [key: string]: unknown;
}

export interface CallSession {
  meeting: ChimeMeeting;
  attendee: ChimeAttendee;
}

export async function startCall(roomCode: string, roomToken: string): Promise<CallSession> {
  const res = await fetch(`${API_URL}/calls/${encodeURIComponent(roomCode)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${roomToken}` },
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, 'No se pudo iniciar la llamada'));
  return res.json();
}
