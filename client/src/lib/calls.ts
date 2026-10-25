import { getAccessToken } from './auth';

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

async function authorizedPost<T>(path: string): Promise<T> {
  const accessToken = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) throw new Error('No se pudo iniciar la llamada');
  return res.json();
}

export async function startCall(roomCode: string): Promise<CallSession> {
  const meeting = await authorizedPost<ChimeMeeting>(`/calls/${roomCode}`);
  const attendee = await authorizedPost<ChimeAttendee>(
    `/calls/meetings/${meeting.MeetingId}/attendees`,
  );
  return { meeting, attendee };
}
