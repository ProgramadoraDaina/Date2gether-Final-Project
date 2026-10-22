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
  if (!accessToken) throw new Error('Necesitás iniciar sesión para crear una reunión');

  const res = await fetch(`${API_URL}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name }),
  });
  if (res.status === 401) throw new Error('Tu sesión venció o cerraste sesión en otra pestaña');
  if (!res.ok) throw new Error('No se pudo crear la reunión');
  return res.json();
}
