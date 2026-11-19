import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateRoomEmojiDto } from './create-room-emoji.dto';

function emojiErrors(emoji: string): number {
  const dto = plainToInstance(CreateRoomEmojiDto, { name: 'test', emoji });
  return validateSync(dto).filter((e) => e.property === 'emoji').length;
}

describe('CreateRoomEmojiDto.emoji', () => {
  it.each(['💀', '🗿', '👍🏽', '👨‍👩‍👧', '🇦🇷', '❤️'])('acepta un solo emoji: %s', (emoji) => {
    expect(emojiErrors(emoji)).toBe(0);
  });

  it.each(['💀💀', 'hola', '<b>', '💀 ', 'a💀'])(
    'rechaza lo que no es un único emoji: %s',
    (emoji) => {
      expect(emojiErrors(emoji)).toBe(1);
    },
  );
});

describe('CreateRoomEmojiDto opciones de sticker', () => {
  function errorsFor(extra: Record<string, unknown>): string[] {
    const dto = plainToInstance(CreateRoomEmojiDto, { name: 'test', emoji: '💀', ...extra });
    return validateSync(dto).map((e) => e.property);
  }

  it('acepta un sticker completo, con la duración llegando como texto del formulario', () => {
    expect(
      errorsFor({
        callMode: 'sticker',
        stickerDuration: '30',
        stickerPosition: 'bottom-left',
        stickerSize: 'large',
        stickerAnimation: 'spin',
      }),
    ).toEqual([]);
  });

  it('rechaza duraciones, posiciones o animaciones fuera de las opciones', () => {
    expect(errorsFor({ stickerDuration: '7' })).toEqual(['stickerDuration']);
    expect(errorsFor({ stickerPosition: 'arriba' })).toEqual(['stickerPosition']);
    expect(errorsFor({ stickerAnimation: 'baila' })).toEqual(['stickerAnimation']);
    expect(errorsFor({ callMode: 'otro' })).toEqual(['callMode']);
  });
});
