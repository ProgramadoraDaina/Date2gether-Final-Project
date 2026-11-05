import { describe, expect, it } from '@jest/globals';
import { generateRoomCode } from './generate-room-code';

describe('generateRoomCode', () => {
  it('tiene el formato de Google Meet: tres letras, guion, cuatro letras, guion, tres letras, todo en minúsculas', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateRoomCode()).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    }
  });
});
