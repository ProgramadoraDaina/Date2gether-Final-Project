import { describe, expect, it } from '@jest/globals';
import { applyThemeToDocument } from './dom-helpers';

describe('applyThemeToDocument', () => {
  it('escribe el tema actual en el dataset del <html>, que es lo que el CSS usa para pintar claro/oscuro', () => {
    applyThemeToDocument('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyThemeToDocument('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
