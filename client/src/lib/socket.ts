import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function createRoomSocket(): Socket {
  return io(`${API_URL}/rooms`, { autoConnect: false, auth: { token: getAccessToken() } });
}
