import { describe, expect, it } from '@jest/globals';
import { shortcutFor } from './shortcuts';

const press = (key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}) => ({
  key,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
  target: document.body,
});

describe('shortcutFor', () => {
  it('reconoce los atajos de la llamada', () => {
    expect(shortcutFor(press('d', { ctrl: true }))).toBe('microphone');
    expect(shortcutFor(press('E', { meta: true }))).toBe('camera');
    expect(shortcutFor(press('h', { ctrl: true, alt: true }))).toBe('hand');
    expect(shortcutFor(press('?'))).toBe('help');
  });

  it('ignora teclas sueltas y combinaciones ajenas', () => {
    expect(shortcutFor(press('d'))).toBeNull();
    expect(shortcutFor(press('d', { ctrl: true, alt: true }))).toBeNull();
  });

  it('no se dispara mientras se escribe', () => {
    const input = document.createElement('input');
    expect(shortcutFor({ ...press('d', { ctrl: true }), target: input })).toBeNull();
    expect(shortcutFor({ ...press('?'), target: document.createElement('textarea') })).toBeNull();
  });
});
