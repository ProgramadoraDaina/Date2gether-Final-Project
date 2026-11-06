export const TRANSCRIPT_TOPIC = 'transcript';
export const MAX_CAPTION_LENGTH = 500;
// Tiempo que queda visible una frase terminada si la persona no sigue hablando.
export const CAPTION_LIFETIME_MS = 5000;

// `id` identifica la frase: los resultados parciales y el final de una misma frase comparten id.
export interface CaptionMessage {
  id: string;
  text: string;
  final: boolean;
}

export interface Caption extends CaptionMessage {
  identity: string;
  name: string;
  at: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeCaption(message: CaptionMessage): Uint8Array {
  return encoder.encode(JSON.stringify(message));
}

// Cualquier participante puede publicar datos: se valida la forma y se recorta el largo.
export function decodeCaption(payload: Uint8Array): CaptionMessage | null {
  try {
    const { id, text, final } = JSON.parse(decoder.decode(payload)) as Partial<CaptionMessage>;
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
    if (typeof text !== 'string' || typeof final !== 'boolean') return null;
    const trimmed = text.trim().slice(0, MAX_CAPTION_LENGTH);
    return trimmed ? { id, text: trimmed, final } : null;
  } catch {
    return null;
  }
}

// Idioma de reconocimiento según el idioma elegido en la app.
export function recognitionLang(language: 'es' | 'en'): string {
  return language === 'es' ? 'es-AR' : 'en-US';
}
