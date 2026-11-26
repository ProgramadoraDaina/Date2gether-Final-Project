import { describe, expect, it } from '@jest/globals';
import type { BreakoutRoomAdminView, BreakoutRoomPublicView } from '@/lib/breakouts';
import { openBreakoutsOf } from './OpenBreakouts';

const room = (overrides: Partial<BreakoutRoomPublicView>): BreakoutRoomPublicView => ({
  id: 'b1',
  label: 'Mini sala 1',
  leavePolicy: 'free_return',
  joinPolicy: 'open',
  autoCloseAt: null,
  occupantCount: 0,
  selfAssigned: false,
  ...overrides,
});

describe('openBreakoutsOf', () => {
  it('muestra solo las mini salas abiertas en las que todavía no estás', () => {
    const rooms = [
      room({ id: 'abierta' }),
      room({ id: 'cerrada', joinPolicy: 'admin_only' }),
      room({ id: 'propia', selfAssigned: true }),
    ];
    expect(openBreakoutsOf(rooms).map((r) => r.id)).toEqual(['abierta']);
  });

  it('con la vista de admin no ofrece nada: el admin usa su propio panel', () => {
    const admin = { ...room({}), occupants: [] } as unknown as BreakoutRoomAdminView;
    expect(openBreakoutsOf([admin])).toEqual([]);
  });
});
