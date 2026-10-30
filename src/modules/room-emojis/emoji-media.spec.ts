import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { EMOJI_SIZE_PX, processEmojiImage, validateEmojiSound } from './emoji-media';

function pngOfSize(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 157, g: 0, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

// WAV PCM mono de 8 kHz y 8 bits: 8000 bytes por segundo de silencio.
function wavOfSeconds(seconds: number): Buffer {
  const dataSize = 8000 * seconds;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.alloc(dataSize, 128)]);
}

describe('processEmojiImage', () => {
  it('convierte la imagen a WebP de 128px como máximo', async () => {
    const result = await processEmojiImage(await pngOfSize(1024, 512));

    expect(result.mime).toBe('image/webp');
    const meta = await sharp(result.data).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(EMOJI_SIZE_PX);
    expect(meta.height).toBe(EMOJI_SIZE_PX / 2);
  });

  it('rechaza un archivo que no es una imagen', async () => {
    await expect(processEmojiImage(Buffer.from('no soy una imagen'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('validateEmojiSound', () => {
  it('acepta un WAV corto y toma el mimetype del contenido real', async () => {
    const result = await validateEmojiSound(wavOfSeconds(2));

    expect(result.mime).toBe('audio/wav');
  });

  it('rechaza un audio de más de 5 segundos', async () => {
    await expect(validateEmojiSound(wavOfSeconds(6))).rejects.toThrow('más de 5 segundos');
  });

  it('rechaza un audio de más de 512 KB', async () => {
    await expect(validateEmojiSound(wavOfSeconds(70))).rejects.toThrow('512 KB');
  });

  it('rechaza un archivo que no es audio', async () => {
    await expect(validateEmojiSound(await pngOfSize(8, 8))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
