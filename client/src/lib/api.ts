import { getAccessToken } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface Room {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export async function createRoom(name: string): Promise<Room> {
  const accessToken = getAccessToken();
  const res = await fetch(`${API_URL}/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('No se pudo crear la reunión');
  return res.json();
}
