import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { isUniqueViolation, kindOf } from './room-emojis.service';

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

describe('kindOf', () => {
  const sound = Buffer.from('audio');

  it('una imagen o un emoji (con o sin sonido) es un emoji de sala', () => {
    expect(kindOf({ image: Buffer.from('img') })).toBe('emoji');
    expect(kindOf({ emoji: '💀', sound })).toBe('emoji');
  });

  it('solo un sonido (archivo o Freesound) es un sonido de sala', () => {
    expect(kindOf({ sound })).toBe('sound');
    expect(kindOf({ freesoundId: 519274 })).toBe('sound');
  });

  it('rechaza contenido vacío o combinaciones imposibles', () => {
    expect(() => kindOf({})).toThrow(BadRequestException);
    expect(() => kindOf({ image: Buffer.from('img'), emoji: '💀' })).toThrow(BadRequestException);
    expect(() => kindOf({ sound, freesoundId: 1 })).toThrow(BadRequestException);
  });
});
