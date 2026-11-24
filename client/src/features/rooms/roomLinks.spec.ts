import { describe, expect, it } from '@jest/globals';
import { linkFromMessage } from './roomLinks';

describe('linkFromMessage', () => {
  it('toma el primer link http(s) y usa el resto del mensaje como título', () => {
    expect(linkFromMessage('Apunte de hoy: https://docs.example.com/clase-1 (leerlo)')).toEqual({
      url: 'https://docs.example.com/clase-1',
      title: 'Apunte de hoy: (leerlo)',
    });
  });

  it('sin texto alrededor no manda título', () => {
    expect(linkFromMessage('http://example.com/a?b=1')).toEqual({
      url: 'http://example.com/a?b=1',
      title: undefined,
    });
  });

  it('quita la puntuación final que no es parte del link', () => {
    expect(linkFromMessage('mirá https://example.com/video.')?.url).toBe(
      'https://example.com/video',
    );
  });

  it('un mensaje sin link (o con otro esquema) no se puede fijar', () => {
    expect(linkFromMessage('hola a todos')).toBeNull();
    expect(linkFromMessage('javascript:alert(1)')).toBeNull();
  });

  it('recorta el título al máximo que acepta el backend', () => {
    const title = linkFromMessage(`${'a'.repeat(200)} https://example.com`)?.title;
    expect(title).toHaveLength(120);
  });
});
