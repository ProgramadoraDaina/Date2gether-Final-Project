import type { ChatMessage } from '@/lib/api';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

// Mensajes seguidos de la misma persona en pocos minutos se muestran bajo un solo nombre.
export function startsGroup(previous: ChatMessage | undefined, message: ChatMessage): boolean {
  if (!previous || previous.authorName !== message.authorName) return true;
  return Date.parse(message.createdAt) - Date.parse(previous.createdAt) > GROUP_WINDOW_MS;
}
