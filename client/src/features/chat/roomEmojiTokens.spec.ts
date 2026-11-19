import { describe, expect, it } from '@jest/globals';
import type { RoomEmoji } from '@/lib/api';
import { isJumboEmojiMessage, splitRoomEmojiTokens } from './roomEmojiTokens';

const bruh: RoomEmoji = {
  id: '3f1c2a9e-7b4d-4e8a-9c1f-2d5e6a7b8c9d',
  name: 'bruh',
  kind: 'emoji',
  emoji: null,
  hasSound: true,
  soundAttribution: null,
  callMode: 'reaction',
  sticker: { duration: 10, position: 'top-right', size: 'medium', animation: 'static' },
  version: 1762300800000,
};
const calavera: RoomEmoji = {
  ...bruh,
  id: 'b65a259f-3755-430e-bb78-aff0813bee80',
  name: 'calavera',
  emoji: '💀',
};
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

  it('un sonido de sala escrito como :nombre: queda como texto', () => {
    const airhorn: RoomEmoji = {
      ...bruh,
      id: '37cdf7e8-ff6a-47ce-8d6b-7f4e51bdd2ed',
      name: 'airhorn',
      kind: 'sound',
    };
    const withSound = new Map([...byName, ['airhorn', airhorn]]);
    expect(splitRoomEmojiTokens('dale :airhorn:', withSound)).toEqual([
      { kind: 'text', text: 'dale :airhorn:' },
    ]);
  });

  it('no toca un texto sin emojis', () => {
    expect(splitRoomEmojiTokens('a las 10:30: nos vemos', byName)).toEqual([
      { kind: 'text', text: 'a las 10:30: nos vemos' },
    ]);
  });
});

describe('isJumboEmojiMessage', () => {
  const jumbo = (text: string) => isJumboEmojiMessage(splitRoomEmojiTokens(text, byName));

  it('agranda un mensaje de solo emojis, hasta 3', () => {
    expect(jumbo('😂')).toBe(true);
    expect(jumbo(':bruh:')).toBe(true);
    expect(jumbo(' 🔥 :calavera: 👍🏽 ')).toBe(true);
    expect(jumbo('🧑‍🌾🇦🇷')).toBe(true);
  });

  it('no agranda con más de 3 emojis', () => {
    expect(jumbo('😂😂😂😂')).toBe(false);
    expect(jumbo(':bruh::bruh::bruh::bruh:')).toBe(false);
  });

  it('no agranda si hay texto junto a los emojis', () => {
    expect(jumbo('jaja 😂')).toBe(false);
    expect(jumbo(':bruh: posta')).toBe(false);
    expect(jumbo('123')).toBe(false);
    expect(jumbo(':inexistente:')).toBe(false);
    expect(jumbo('   ')).toBe(false);
  });
});
