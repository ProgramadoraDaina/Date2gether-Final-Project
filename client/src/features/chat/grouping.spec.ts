import { describe, expect, it } from '@jest/globals';
import type { ChatMessage } from '@/lib/api';
import { startsGroup } from './grouping';

const message = (authorName: string, createdAt: string): ChatMessage => ({
  id: `${authorName}-${createdAt}`,
  authorName,
  kind: 'text',
  content: 'hola',
  createdAt,
});

describe('startsGroup', () => {
  it('el primer mensaje y el de otra persona abren grupo', () => {
    const ana = message('Ana', '2026-11-25T10:00:00Z');
    expect(startsGroup(undefined, ana)).toBe(true);
    expect(startsGroup(ana, message('Beto', '2026-11-25T10:00:30Z'))).toBe(true);
  });

  it('la misma persona en pocos minutos sigue el grupo, después de 5 minutos abre otro', () => {
    const ana = message('Ana', '2026-11-25T10:00:00Z');
    expect(startsGroup(ana, message('Ana', '2026-11-25T10:04:00Z'))).toBe(false);
    expect(startsGroup(ana, message('Ana', '2026-11-25T10:06:00Z'))).toBe(true);
  });
});
