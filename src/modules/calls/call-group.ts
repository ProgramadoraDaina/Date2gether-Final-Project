// Módulo puro, sin IO, sin decoradores de Nest (design.md D1). Traduce el
// estado de mini salas abiertas de un grupo a la lista de nombres de salas
// de LiveKit que el control de acceso debe considerar.
export const BREAKOUT_NAME_SEPARATOR = '::';

export interface OpenBreakout {
  id: string;
  livekitRoomName: string;
  autoCloseAt: Date | null;
}

/**
 * [roomCode, ...nombres de mini salas abiertas y NO vencidas] + las
 * vencidas aparte. Con una lista vacía de mini salas abiertas, degenera al
 * camino de hoy: un solo nombre, la sala principal, cero vencidas.
 *
 * El filtro de vencimiento (D1, design.md) es puro y sincrónico: una mini
 * sala con `autoCloseAt <= now` se excluye de `names` aunque su teardown
 * todavía no haya corrido -- nunca sostiene viva a la llamada. Una mini
 * sala ya cerrada (`closedAt` no nulo, filtrado por el llamador antes de
 * entrar acá según el diseño) tampoco aparece en ningún lado.
 */
export function buildCallGroupRoomNames(
  roomCode: string,
  openBreakouts: OpenBreakout[],
  now: Date,
): { names: string[]; expired: OpenBreakout[] } {
  const names = [roomCode];
  const expired: OpenBreakout[] = [];

  for (const breakout of openBreakouts) {
    if (breakout.autoCloseAt !== null && breakout.autoCloseAt <= now) {
      expired.push(breakout);
      continue;
    }
    names.push(breakout.livekitRoomName);
  }

  return { names, expired };
}

export function buildBreakoutRoomName(roomCode: string, index: number): string {
  return `${roomCode}${BREAKOUT_NAME_SEPARATOR}breakout-${index}`;
}

/**
 * Nombre de mini sala -> código de la sala padre + índice de slot. `null`
 * para cualquier nombre que no tenga la forma exacta
 * `${parentCode}::breakout-${index}` con índice entero.
 */
export function parseBreakoutRoomName(name: string): { parentCode: string; index: number } | null {
  const separatorIndex = name.indexOf(BREAKOUT_NAME_SEPARATOR);
  if (separatorIndex === -1) return null;

  const parentCode = name.slice(0, separatorIndex);
  const suffix = name.slice(separatorIndex + BREAKOUT_NAME_SEPARATOR.length);
  const match = /^breakout-(\d+)$/.exec(suffix);
  if (!parentCode || !match) return null;

  return { parentCode, index: Number(match[1]) };
}

export function isBreakoutRoomName(name: string): boolean {
  return name.includes(BREAKOUT_NAME_SEPARATOR);
}

// Decisión 2 (design.md "Señal de motivo de remoción"): unión cerrada,
// compartida sin cambios entre BreakoutRoomsService (moveIn, selfReturn) y
// CallsWebhookService (expulsión locked), y consumida por el cliente para
// distinguir un traslado/vuelta esperada de una expulsión por política.
export const BREAKOUT_REMOVAL_REASONS = [
  'BREAKOUT_MOVE_IN', // moveIn -- traslado en curso, esperado
  'BREAKOUT_FORCED_RETURN', // selfReturn, camino admin -- vuelta forzada, esperada
  'BREAKOUT_RETURN_LOCKED', // webhook, expulsión por política (reusa BREAKOUT_RETURN_LOCKED_CODE)
] as const;

export type BreakoutRemovalReason = (typeof BREAKOUT_REMOVAL_REASONS)[number];

export function isBreakoutRemovalReason(value: string): value is BreakoutRemovalReason {
  return (BREAKOUT_REMOVAL_REASONS as readonly string[]).includes(value);
}
