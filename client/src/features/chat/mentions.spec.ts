import { describe, expect, it } from '@jest/globals';
import { getMentionQuery, isSelfMentioned, splitMentions } from './mentions';

describe('mentions', () => {
  it('matches full names and escapes special characters', () => {
    const text = 'Hola @Ana Maria, @Ana y @C++!';
    const segments = splitMentions(text, ['Ana', 'Ana Maria', 'C++']);
    expect(segments.filter((segment) => segment.mention).map((segment) => segment.text)).toEqual([
      '@Ana Maria',
      '@Ana',
      '@C++',
    ]);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
  });

  it('does not highlight emails or a prefix of another name', () => {
    const segments = splitMentions('correo@Ana.com @Anabella @Ana_2 @Ana!', ['Ana']);
    expect(segments.filter((segment) => segment.mention).map((segment) => segment.text)).toEqual([
      '@Ana',
    ]);
  });

  it('supports case insensitive names and punctuation', () => {
    expect(splitMentions('(@ANA), @ana.', ['Ana']).filter((segment) => segment.mention)).toEqual([
      { text: '@ANA', mention: true },
      { text: '@ana', mention: true },
    ]);
  });

  it('locates the token at the cursor and preserves the surrounding message', () => {
    expect(getMentionQuery('Hola @alex seguimos', 8)).toEqual({ start: 5, end: 10, query: 'al' });
    expect(getMentionQuery('correo@alex.com', 11)).toBeNull();
    expect(getMentionQuery('Hola @', 6)).toEqual({ start: 5, end: 6, query: '' });
  });

  describe('isSelfMentioned', () => {
    it('matches by name', () => {
      expect(isSelfMentioned('Hola @Ana', { name: 'Ana', roleKeywords: [] })).toBe(true);
      expect(isSelfMentioned('Hola @Bruno', { name: 'Ana', roleKeywords: [] })).toBe(false);
    });

    it('matches a role mention for anyone who holds that role', () => {
      expect(
        isSelfMentioned('avisen @colaborador', { name: 'Ana', roleKeywords: ['colaborador'] }),
      ).toBe(true);
      expect(
        isSelfMentioned('avisen @colaborador', { name: 'Ana', roleKeywords: ['participante'] }),
      ).toBe(false);
    });

    it('matches the guest group mention', () => {
      expect(
        isSelfMentioned('bienvenidos @invitados', { name: 'Ana', roleKeywords: ['invitados'] }),
      ).toBe(true);
    });

    it('returns false without a name or role to match against', () => {
      expect(isSelfMentioned('@Ana', { name: '', roleKeywords: [] })).toBe(false);
    });
  });
});
