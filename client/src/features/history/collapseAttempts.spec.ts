import { describe, expect, it } from '@jest/globals';
import type { CallHistoryEntry } from '@/lib/api';
import { collapseAttempts } from './collapseAttempts';

const entry = (
  id: string,
  startedAt: string,
  sessionId: string | null,
  roomId = 'r1',
): CallHistoryEntry => ({
  id,
  roomId,
  roomCode: 'abc-defg-hij',
  roomName: 'Sala',
  startedAt: `2026-11-18T${startedAt}:00.000Z`,
  sessionId,
});

describe('collapseAttempts', () => {
  it('oculta los reintentos fallidos que terminaron en una llamada de la misma sala', () => {
    const rows = [
      entry('ok', '21:51', 's1'),
      entry('fallo1', '21:49', null),
      entry('fallo2', '21:48', null),
    ];
    expect(collapseAttempts(rows).map((r) => r.id)).toEqual(['ok']);
  });

  it('deja una sola fila por llamada aunque hayas entrado varias veces', () => {
    const rows = [entry('re', '22:10', 's1'), entry('primera', '21:51', 's1')];
    expect(collapseAttempts(rows).map((r) => r.id)).toEqual(['primera']);
  });

  it('mantiene los intentos que no terminaron en ninguna llamada', () => {
    const rows = [
      entry('ok', '21:51', 's1'),
      entry('viejo', '18:57', null),
      entry('otra-sala', '21:50', null, 'r2'),
    ];
    expect(collapseAttempts(rows).map((r) => r.id)).toEqual(['ok', 'viejo', 'otra-sala']);
  });
});
