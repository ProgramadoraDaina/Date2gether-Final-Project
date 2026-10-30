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
