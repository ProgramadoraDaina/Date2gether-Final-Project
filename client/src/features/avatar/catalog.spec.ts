import { describe, expect, it } from '@jest/globals';
import { FACE_PIECES, HEAD_PIECES, NECK_PIECES, randomAvatar, toAvatar } from './catalog';

describe('toAvatar', () => {
  it('descarta piezas y colores que no son del catálogo', () => {
    expect(
      toAvatar({
        head: 'cap',
        face: 'dominus',
        colors: { head: '#3D7BE0', face: '#ffffff', neck: 'red' },
        sticker: false,
      }),
    ).toEqual({ head: 'cap', colors: { head: '#3d7be0' }, sticker: false });
  });
});

describe('randomAvatar', () => {
  it('arma un avatar al azar solo con piezas del catálogo y respeta el sticker', () => {
    for (let i = 0; i < 30; i += 1) {
      const avatar = randomAvatar(false);
      expect(Object.keys(HEAD_PIECES)).toContain(avatar.head);
      expect(Object.keys(FACE_PIECES)).toContain(avatar.face);
      if (avatar.neck) expect(Object.keys(NECK_PIECES)).toContain(avatar.neck);
      expect(avatar.sticker).toBe(false);
    }
  });
});
