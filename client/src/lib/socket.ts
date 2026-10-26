import { io, type Socket } from 'socket.io-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function createRoomSocket(roomToken: string): Socket {
  return io(`${API_URL}/rooms`, { autoConnect: false, auth: { token: roomToken } });
}
