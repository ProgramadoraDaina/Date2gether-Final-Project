import { describe, expect, it } from '@jest/globals';
import { loginUrlFor, readNextPath, sanitizeNextPath } from './safeRedirect';

describe('sanitizeNextPath', () => {
  it.each(['/rooms', '/rooms?x=1', '/history/abc?x=1#transcript', '/'])('accepts %s', (path) => {
    expect(sanitizeNextPath(path)).toBe(path);
  });

  it.each([
    '//evil.com',
    'https://evil.com',
    'http://evil.com/rooms',
    'javascript:alert(1)',
    String.raw`/\evil.com`,
    '/\t/evil.com',
    'rooms',
    '',
    null,
    undefined,
  ])('rejects %p', (path) => {
    expect(sanitizeNextPath(path)).toBeNull();
  });
});

describe('loginUrlFor', () => {
  it('encodes the original path and query into ?next=', () => {
    expect(loginUrlFor('/rooms?x=1')).toBe('/login?next=%2Frooms%3Fx%3D1');
  });
});

describe('readNextPath', () => {
  it('returns the safe ?next= value, or the fallback otherwise', () => {
    window.history.replaceState(null, '', '/login?next=%2Frooms%3Fx%3D1');
    expect(readNextPath()).toBe('/rooms?x=1');

    window.history.replaceState(null, '', '/login?next=%2F%2Fevil.com');
    expect(readNextPath()).toBe('/');

    window.history.replaceState(null, '', '/login');
    expect(readNextPath('/home')).toBe('/home');
  });
});
