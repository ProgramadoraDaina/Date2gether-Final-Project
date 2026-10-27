import { randomInt } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

function randomSegment(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += ALPHABET[randomInt(ALPHABET.length)];
  }
  return result;
}

/** Genera un código de sala estilo Google Meet, ej: "abc-defg-hij" */
export function generateRoomCode(): string {
  return `${randomSegment(3)}-${randomSegment(4)}-${randomSegment(3)}`;
}
