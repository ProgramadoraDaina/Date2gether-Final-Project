import { BadRequestException } from '@nestjs/common';
import { parseBuffer } from 'music-metadata';
import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_SOUND_BYTES = 512 * 1024;
export const MAX_SOUND_SECONDS = 5;
export const EMOJI_SIZE_PX = 128;

const IMAGE_FORMATS = new Set(['png', 'jpeg', 'webp', 'gif']);

// El contenedor detectado manda, no el mimetype que declara el navegador.
const SOUND_MIME_BY_CONTAINER: Record<string, string> = {
  MPEG: 'audio/mpeg',
  Ogg: 'audio/ogg',
  WAVE: 'audio/wav',
};

export interface ProcessedMedia {
  data: Buffer;
  mime: string;
}

// Re-codificar descarta metadatos y cualquier contenido extra del archivo original.
export async function processEmojiImage(input: Buffer): Promise<ProcessedMedia> {
  try {
    const image = sharp(input, { animated: true, limitInputPixels: 4096 * 4096 });
    const { format } = await image.metadata();
    if (!format || !IMAGE_FORMATS.has(format)) throw new Error('unsupported format');
    const data = await image
      .resize(EMOJI_SIZE_PX, EMOJI_SIZE_PX, { fit: 'inside' })
      .webp({ quality: 80 })
      .toBuffer();
    return { data, mime: 'image/webp' };
  } catch {
    throw new BadRequestException('La imagen no es válida. Usá PNG, JPG, WebP o GIF.');
  }
}

export async function validateEmojiSound(input: Buffer): Promise<ProcessedMedia> {
  if (input.length > MAX_SOUND_BYTES) {
    throw new BadRequestException('El audio no puede superar los 512 KB');
  }
  let container: string | undefined;
  let duration: number | undefined;
  try {
    const { format } = await parseBuffer(input, undefined, { duration: true });
    container = format.container;
    duration = format.duration;
  } catch {
    throw new BadRequestException('El audio no es válido. Usá MP3, OGG o WAV.');
  }
  const mime = container ? SOUND_MIME_BY_CONTAINER[container] : undefined;
  if (!mime) throw new BadRequestException('El audio no es válido. Usá MP3, OGG o WAV.');
  if (duration === undefined || duration > MAX_SOUND_SECONDS) {
    throw new BadRequestException(`El audio no puede durar más de ${MAX_SOUND_SECONDS} segundos`);
  }
  return { data: input, mime };
}
