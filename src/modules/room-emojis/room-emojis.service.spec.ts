import { describe, expect, it } from '@jest/globals';
import { isUniqueViolation } from './room-emojis.service';

describe('isUniqueViolation', () => {
  it('detecta el nombre repetido cuando Drizzle envuelve el error de Postgres en cause', () => {
    const drizzleError = Object.assign(new Error('Failed query'), { cause: { code: '23505' } });

    expect(isUniqueViolation(drizzleError)).toBe(true);
  });

  it('detecta el código también si llega directo', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('no confunde otros errores de la base con un nombre repetido', () => {
    expect(isUniqueViolation({ cause: { code: '23503' } })).toBe(false);
    expect(isUniqueViolation(new Error('timeout'))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
