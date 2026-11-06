import { describe, expect, it } from '@jest/globals';
import { decodeCaption, encodeCaption, MAX_CAPTION_LENGTH, recognitionLang } from './transcript';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('decodeCaption', () => {
  it('recupera la frase que se codificó al enviar', () => {
    const message = { id: 'frase-1', text: 'Hola, ¿me escuchás?', final: true };
    expect(decodeCaption(encodeCaption(message))).toEqual(message);
  });

  it('recorta espacios y frases demasiado largas', () => {
    const long = 'a'.repeat(MAX_CAPTION_LENGTH + 50);
    expect(
      decodeCaption(encode({ id: 'x', text: `  ${long}  `, final: false }))?.text,
    ).toHaveLength(MAX_CAPTION_LENGTH);
  });

  it('descarta mensajes con forma inválida o texto vacío', () => {
    expect(decodeCaption(encode({ id: 'x', text: '   ', final: true }))).toBeNull();
    expect(decodeCaption(encode({ id: 'x', text: 42, final: true }))).toBeNull();
    expect(decodeCaption(encode({ id: 'x', text: 'hola' }))).toBeNull();
    expect(decodeCaption(encode({ text: 'hola', final: true }))).toBeNull();
    expect(decodeCaption(encode({ id: 'x'.repeat(65), text: 'hola', final: true }))).toBeNull();
    expect(decodeCaption(new TextEncoder().encode('no es json'))).toBeNull();
  });
});

describe('recognitionLang', () => {
  it('usa español rioplatense o inglés según el idioma de la app', () => {
    expect(recognitionLang('es')).toBe('es-AR');
    expect(recognitionLang('en')).toBe('en-US');
  });
});
