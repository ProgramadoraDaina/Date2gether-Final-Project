import type { CallHistoryEntry } from '@/lib/api';

const RETRY_WINDOW_MS = 10 * 60 * 1000;

// Cada "Entrar" guarda una fila: dejamos una por llamada y ocultamos los reintentos que terminaron en esa llamada.
export function collapseAttempts(entries: readonly CallHistoryEntry[]): CallHistoryEntry[] {
  const earliestBySession = new Map<string, CallHistoryEntry>();
  for (const entry of entries) {
    if (!entry.sessionId) continue;
    const kept = earliestBySession.get(entry.sessionId);
    if (!kept || Date.parse(entry.startedAt) < Date.parse(kept.startedAt)) {
      earliestBySession.set(entry.sessionId, entry);
    }
  }
  const joins = [...earliestBySession.values()];
  return entries.filter((entry) => {
    if (entry.sessionId) return earliestBySession.get(entry.sessionId) === entry;
    const at = Date.parse(entry.startedAt);
    return !joins.some((join) => {
      const gap = Date.parse(join.startedAt) - at;
      return join.roomId === entry.roomId && gap >= 0 && gap <= RETRY_WINDOW_MS;
    });
  });
}
