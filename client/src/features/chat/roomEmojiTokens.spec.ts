import { describe, expect, it } from '@jest/globals';
import type { RoomEmoji } from '@/lib/api';
import { splitRoomEmojiTokens } from './roomEmojiTokens';

const bruh: RoomEmoji = {
  id: '3f1c2a9e-7b4d-4e8a-9c1f-2d5e6a7b8c9d',
  name: 'bruh',
  emoji: null,
  hasSound: true,
  soundAttribution: null,
};
const calavera: RoomEmoji = { ...bruh, id: 'b65a259f-3755-430e-bb78-aff0813bee80', name: 'calavera', emoji: '💀' };
const byName = new Map([bruh, calavera].map((e) => [e.name, e]));

describe('splitRoomEmojiTokens', () => {
  it('reemplaza los :nombre: de la sala y deja el texto alrededor', () => {
    expect(splitRoomEmojiTokens('jaja :bruh: posta :calavera:', byName)).toEqual([
      { kind: 'text', text: 'jaja ' },
      { kind: 'emoji', emoji: bruh },
      { kind: 'text', text: ' posta ' },
      { kind: 'emoji', emoji: calavera },
    ]);
  });

  it('deja como texto un :nombre: que no existe en la sala', () => {
    expect(splitRoomEmojiTokens('hola :inexistente:', byName)).toEqual([
      { kind: 'text', text: 'hola :inexistente:' },
    ]);
  });

  it('soporta emojis pegados y repetidos', () => {
    expect(splitRoomEmojiTokens(':bruh::bruh:', byName)).toEqual([
      { kind: 'emoji', emoji: bruh },
      { kind: 'emoji', emoji: bruh },
    ]);
  });

  it('no toca un texto sin emojis', () => {
    expect(splitRoomEmojiTokens('a las 10:30: nos vemos', byName)).toEqual([
      { kind: 'text', text: 'a las 10:30: nos vemos' },
    ]);
  });
});
