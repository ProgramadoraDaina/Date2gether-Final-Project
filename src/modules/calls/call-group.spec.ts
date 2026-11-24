import { describe, expect, it } from 'vitest';
import {
  BREAKOUT_REMOVAL_REASONS,
  buildBreakoutRoomName,
  buildCallGroupRoomNames,
  isBreakoutRemovalReason,
  isBreakoutRoomName,
  parseBreakoutRoomName,
  type OpenBreakout,
} from './call-group';

describe('buildCallGroupRoomNames', () => {
  it('[C8] sin mini salas abiertas, devuelve solo el código de la sala principal y ninguna vencida', () => {
    const result = buildCallGroupRoomNames('abc-defg-hij', [], new Date());

    expect(result).toEqual({ names: ['abc-defg-hij'], expired: [] });
  });

  it('[4.1.1] con 1-3 mini salas abiertas, devuelve [roomCode, ...nombres] con la principal primero y orden estable', () => {
    const now = new Date('2026-11-22T10:00:00Z');
    const breakouts: OpenBreakout[] = [
      { id: 'b1', livekitRoomName: 'abc-defg-hij::breakout-1', autoCloseAt: null },
      { id: 'b2', livekitRoomName: 'abc-defg-hij::breakout-2', autoCloseAt: null },
      { id: 'b3', livekitRoomName: 'abc-defg-hij::breakout-3', autoCloseAt: null },
    ];

    const result = buildCallGroupRoomNames('abc-defg-hij', breakouts, now);

    expect(result).toEqual({
      names: [
        'abc-defg-hij',
        'abc-defg-hij::breakout-1',
        'abc-defg-hij::breakout-2',
        'abc-defg-hij::breakout-3',
      ],
      expired: [],
    });
  });

  it('[4.1.2] una mini sala con autoCloseAt <= now queda excluida de names e incluida en expired', () => {
    const now = new Date('2026-11-22T10:00:00Z');
    const expiredBreakout: OpenBreakout = {
      id: 'b1',
      livekitRoomName: 'abc-defg-hij::breakout-1',
      autoCloseAt: new Date('2026-11-22T09:59:00Z'),
    };
    const activeBreakout: OpenBreakout = {
      id: 'b2',
      livekitRoomName: 'abc-defg-hij::breakout-2',
      autoCloseAt: new Date('2026-11-22T10:30:00Z'),
    };

    const result = buildCallGroupRoomNames('abc-defg-hij', [expiredBreakout, activeBreakout], now);

    expect(result).toEqual({
      names: ['abc-defg-hij', 'abc-defg-hij::breakout-2'],
      expired: [expiredBreakout],
    });
  });

  it('[4.1.3] una mini sala con closedAt no nulo (ya filtrada por el llamador antes de entrar acá) nunca aparece en names ni en expired', () => {
    // buildCallGroupRoomNames recibe únicamente mini salas ABIERTAS
    // (OpenBreakout no tiene closedAt en su forma): el filtro de "cerrada"
    // ocurre antes de construir la lista que entra acá -- este test fija que
    // la función pura no necesita (ni tiene cómo) volver a chequear eso.
    const now = new Date('2026-11-22T10:00:00Z');
    const stillOpen: OpenBreakout = {
      id: 'b1',
      livekitRoomName: 'abc-defg-hij::breakout-1',
      autoCloseAt: null,
    };

    const result = buildCallGroupRoomNames('abc-defg-hij', [stillOpen], now);

    expect(result.names).toEqual(['abc-defg-hij', 'abc-defg-hij::breakout-1']);
    expect(result.expired).toEqual([]);
  });
});

describe('parseBreakoutRoomName', () => {
  it('[4.1.5] nombre válido code::breakout-2 -> { parentCode: "code", index: 2 }', () => {
    expect(parseBreakoutRoomName('code::breakout-2')).toEqual({ parentCode: 'code', index: 2 });
  });

  it('[4.1.5] código sin "::" -> null', () => {
    expect(parseBreakoutRoomName('abc-defg-hij')).toBeNull();
  });

  it('[4.1.5] "::" suelto sin índice -> null', () => {
    expect(parseBreakoutRoomName('abc-defg-hij::')).toBeNull();
  });

  it('[4.1.5] índice no numérico -> null', () => {
    expect(parseBreakoutRoomName('abc-defg-hij::breakout-x')).toBeNull();
  });
});

describe('buildBreakoutRoomName', () => {
  it('arma el nombre de mini sala a partir del código de la sala padre y el índice de slot', () => {
    expect(buildBreakoutRoomName('abc-defg-hij', 1)).toBe('abc-defg-hij::breakout-1');
  });
});

describe('isBreakoutRoomName', () => {
  it('true para un nombre que contiene el separador', () => {
    expect(isBreakoutRoomName('abc-defg-hij::breakout-1')).toBe(true);
  });

  it('false para un código de sala normal', () => {
    expect(isBreakoutRoomName('abc-defg-hij')).toBe(false);
  });
});

// Decisión 2 (design.md "Señal de motivo de remoción"): unión cerrada,
// compartida sin cambios entre breakout-rooms.service (moveIn, selfReturn) y
// calls-webhook.service (expulsión locked) -- un solo lugar que enumera los
// tres motivos posibles evita que un llamador nuevo invente un cuarto string
// suelto.
describe('BreakoutRemovalReason', () => {
  it('[2.1] expone exactamente los tres motivos documentados, sin ninguno extra', () => {
    expect(BREAKOUT_REMOVAL_REASONS).toEqual([
      'BREAKOUT_MOVE_IN',
      'BREAKOUT_FORCED_RETURN',
      'BREAKOUT_RETURN_LOCKED',
    ]);
  });

  it('[2.1] isBreakoutRemovalReason reconoce cada uno de los tres motivos', () => {
    for (const reason of BREAKOUT_REMOVAL_REASONS) {
      expect(isBreakoutRemovalReason(reason)).toBe(true);
    }
  });

  it('[2.1] isBreakoutRemovalReason rechaza un string que no es ninguno de los tres motivos', () => {
    expect(isBreakoutRemovalReason('SOME_OTHER_REASON')).toBe(false);
  });
});
