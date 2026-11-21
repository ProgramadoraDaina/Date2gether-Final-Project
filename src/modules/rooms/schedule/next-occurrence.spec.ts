import { describe, expect, it } from 'vitest';
import { nextOccurrence, type ScheduleSlot } from './next-occurrence';

describe('nextOccurrence', () => {
  it('devuelve null cuando no hay slots', () => {
    expect(nextOccurrence([], new Date('2026-11-15T12:00:00Z'))).toBeNull();
  });

  it('multi-slot: gana el instante más temprano entre todos los slots', () => {
    // now es lunes 2026-11-16T12:00:00Z en UTC. Slot A: miércoles 10:00 UTC
    // (más lejos). Slot B: martes 10:00 UTC (más cerca). B debe ganar.
    const now = new Date('2026-11-16T12:00:00Z'); // lunes
    const slotWednesday: ScheduleSlot = { dayOfWeek: 3, timeOfDay: '10:00', timezone: 'UTC' };
    const slotTuesday: ScheduleSlot = { dayOfWeek: 2, timeOfDay: '10:00', timezone: 'UTC' };

    const result = nextOccurrence([slotWednesday, slotTuesday], now);

    expect(result).toEqual(new Date('2026-11-17T10:00:00Z')); // martes siguiente
  });

  it('un slot ya pasado hoy busca la semana siguiente, no hoy', () => {
    // now es lunes 2026-11-16T12:00:00Z. Slot lunes 08:00 UTC -- ya pasó hoy.
    const now = new Date('2026-11-16T12:00:00Z');
    const slot: ScheduleSlot = { dayOfWeek: 1, timeOfDay: '08:00', timezone: 'UTC' };

    const result = nextOccurrence([slot], now);

    expect(result).toEqual(new Date('2026-11-23T08:00:00Z')); // lunes siguiente
  });

  it('un slot más tarde hoy mismo ocurre hoy', () => {
    const now = new Date('2026-11-16T12:00:00Z'); // lunes
    const slot: ScheduleSlot = { dayOfWeek: 1, timeOfDay: '18:00', timezone: 'UTC' };

    const result = nextOccurrence([slot], now);

    expect(result).toEqual(new Date('2026-11-16T18:00:00Z'));
  });

  it('el día de la semana resultante coincide con el real del instante devuelto, re-derivado de la zona', () => {
    const now = new Date('2026-11-15T00:00:00Z'); // domingo
    const slot: ScheduleSlot = { dayOfWeek: 5, timeOfDay: '09:00', timezone: 'America/New_York' };

    const result = nextOccurrence([slot], now);

    expect(result).not.toBeNull();
    const weekdayInZone = new Intl.DateTimeFormat('en-US', {
      timeZone: slot.timezone,
      weekday: 'short',
    }).format(result!);
    expect(weekdayInZone).toBe('Fri');
  });

  it('[DST hemisferio norte] spring-forward (America/New_York, 2024-03-10): la hora de pared que no existe dispara en el próximo minuto de pared existente', () => {
    // El salto es 02:00 -> 03:00 ese domingo: 02:30 no existe.
    const now = new Date('2024-03-09T12:00:00Z'); // sábado, antes de la transición
    const slot: ScheduleSlot = { dayOfWeek: 0, timeOfDay: '02:30', timezone: 'America/New_York' };

    const result = nextOccurrence([slot], now);

    expect(result).not.toBeNull();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: slot.timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    }).formatToParts(result!);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    expect(map.weekday).toBe('Sun');
    // No debe quedar atascado en 02:30 (no existe); el resultado cae en o
    // después de las 03:00 (el próximo minuto de pared existente).
    expect(Number(map.hour)).toBeGreaterThanOrEqual(3);
  });

  it('[DST hemisferio norte] fall-back (America/New_York, 2024-11-03): la hora ambigua resuelve al instante ANTERIOR a la transición', () => {
    // El retroceso es 02:00 -> 01:00 ese domingo: 01:30 ocurre dos veces.
    const now = new Date('2024-11-02T12:00:00Z'); // sábado, antes de la transición
    const slot: ScheduleSlot = { dayOfWeek: 0, timeOfDay: '01:30', timezone: 'America/New_York' };

    const result = nextOccurrence([slot], now);

    expect(result).not.toBeNull();
    // La primera ocurrencia de 01:30 (en EDT, UTC-4) es más temprana que la
    // segunda (en EST, UTC-5): 2024-11-03T05:30:00Z vs 2024-11-03T06:30:00Z.
    expect(result).toEqual(new Date('2024-11-03T05:30:00Z'));
  });

  it('[DST hemisferio sur] spring-forward (Australia/Sydney, 2024-10-06): no revienta y cae en domingo', () => {
    // Sydney en 2024: DST empieza el 2024-10-06, 02:00 -> 03:00.
    const now = new Date('2024-10-05T12:00:00Z'); // sábado, antes de la transición
    const slot: ScheduleSlot = { dayOfWeek: 0, timeOfDay: '02:30', timezone: 'Australia/Sydney' };

    const result = nextOccurrence([slot], now);

    expect(result).not.toBeNull();
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: slot.timezone,
      weekday: 'short',
    }).format(result!);
    expect(weekday).toBe('Sun');
  });

  it('[DST hemisferio sur] fall-back (Australia/Sydney, 2024-04-07): no revienta y cae en domingo', () => {
    // Sydney en 2024: DST termina el 2024-04-07, 03:00 -> 02:00 (01:30 ambiguo).
    const now = new Date('2024-04-06T12:00:00Z');
    const slot: ScheduleSlot = { dayOfWeek: 0, timeOfDay: '01:30', timezone: 'Australia/Sydney' };

    const result = nextOccurrence([slot], now);

    expect(result).not.toBeNull();
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: slot.timezone,
      weekday: 'short',
    }).format(result!);
    expect(weekday).toBe('Sun');
  });
});
