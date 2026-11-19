import { describe, expect, it } from '@jest/globals';
import { applyLanguageToDocument } from './dom-helpers';

describe('applyLanguageToDocument', () => {
  it('escribe el idioma actual en el atributo lang del <html> — el mismo código que causó el bug de hidratación de la decisión técnica #8', () => {
    applyLanguageToDocument('en');
    expect(document.documentElement.lang).toBe('en');
    applyLanguageToDocument('es');
    expect(document.documentElement.lang).toBe('es');
  });
});
