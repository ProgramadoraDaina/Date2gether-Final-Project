import { io, type Socket } from 'socket.io-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function createRoomSocket(roomToken: string): Socket {
  const url = new URL(API_URL, window.location.origin);
  const prefix = url.pathname.replace(/\/$/, '');
  return io(`${url.origin}/rooms`, {
    autoConnect: false,
    auth: { token: roomToken },
    ...(prefix ? { path: `${prefix}/socket.io` } : {}),
  });
}
