import { describe, expect, it } from 'vitest';
import { getCorsOrigin } from './cors-origin';

describe('getCorsOrigin', () => {
  it('throws when CORS_ORIGIN is missing', () => {
    expect(() => getCorsOrigin({})).toThrow(/CORS_ORIGIN is not set/);
  });

  it('throws when CORS_ORIGIN is empty or whitespace', () => {
    expect(() => getCorsOrigin({ CORS_ORIGIN: '' })).toThrow(/CORS_ORIGIN is not set/);
    expect(() => getCorsOrigin({ CORS_ORIGIN: '   ' })).toThrow(/CORS_ORIGIN is not set/);
  });

  it('rejects the wildcard', () => {
    expect(() => getCorsOrigin({ CORS_ORIGIN: '*' })).toThrow(/wildcard/);
  });

  it('returns a valid single origin, trimmed', () => {
    expect(getCorsOrigin({ CORS_ORIGIN: ' https://app.example.com ' })).toBe(
      'https://app.example.com',
    );
  });

  it.each(['https://app.example.com/', 'app.example.com', 'https://app.example.com/path'])(
    'rejects a value that is not a bare origin: %s',
    (value) => {
      expect(() => getCorsOrigin({ CORS_ORIGIN: value })).toThrow(
        /CORS_ORIGIN must be a bare origin/,
      );
    },
  );

  it('accepts local origins', () => {
    expect(getCorsOrigin({ CORS_ORIGIN: 'http://localhost:3002' })).toBe('http://localhost:3002');
  });
});
