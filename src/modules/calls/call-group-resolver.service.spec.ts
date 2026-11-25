import { beforeEach, describe, expect, it } from 'vitest';
import type { DrizzleDb } from '../../db/drizzle.module';
import { chain, createFakeDb, type FakeDb } from '../../test-support/fake-drizzle';
import { CallGroupResolverService } from './call-group-resolver.service';

describe('CallGroupResolverService', () => {
  let db: FakeDb;
  let resolver: CallGroupResolverService;

  beforeEach(() => {
    db = createFakeDb();
    resolver = new CallGroupResolverService(db as unknown as DrizzleDb);
  });

  describe('resolveCallGroupRoomNames', () => {
    it('[4.2.1] sin filas abiertas -> [roomCode], sin tirar', async () => {
      db.select.mockReturnValueOnce(chain([]));

      await expect(resolver.resolveCallGroupRoomNames('room-1', 'abc-defg-hij')).resolves.toEqual([
        'abc-defg-hij',
      ]);
    });

    it('[4.2.2] con roomId: null -> [roomCode] sin consultar nada', async () => {
      await expect(resolver.resolveCallGroupRoomNames(null, 'abc-defg-hij')).resolves.toEqual([
        'abc-defg-hij',
      ]);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('[4.2.3] con mini salas abiertas no vencidas -> lista completa vía buildCallGroupRoomNames', async () => {
      db.select.mockReturnValueOnce(
        chain([
          { id: 'b1', livekitRoomName: 'abc-defg-hij::breakout-1', autoCloseAt: null },
          { id: 'b2', livekitRoomName: 'abc-defg-hij::breakout-2', autoCloseAt: null },
        ]),
      );

      await expect(resolver.resolveCallGroupRoomNames('room-1', 'abc-defg-hij')).resolves.toEqual([
        'abc-defg-hij',
        'abc-defg-hij::breakout-1',
        'abc-defg-hij::breakout-2',
      ]);
    });
  });

  describe('resolveGroupAnchor', () => {
    it('[4.2.5] roomCode sin "::" -> { parentSid: sid, parentCode: roomCode }, cero consultas a la base (D6)', async () => {
      await expect(resolver.resolveGroupAnchor('RM_session-A', 'abc-defg-hij')).resolves.toEqual({
        parentSid: 'RM_session-A',
        parentCode: 'abc-defg-hij',
      });
      expect(db.select).not.toHaveBeenCalled();
    });

    it('[4.2.6] roomCode con "::" -> resuelve call_breakout_rooms.livekit_room_name y devuelve el parent_livekit_room_sid + código del padre', async () => {
      db.select.mockReturnValueOnce(chain([{ parentLivekitRoomSid: 'RM_parent-A' }]));

      await expect(
        resolver.resolveGroupAnchor('RM_breakout-A', 'abc-defg-hij::breakout-1'),
      ).resolves.toEqual({ parentSid: 'RM_parent-A', parentCode: 'abc-defg-hij' });
    });

    it('[4.5.3] roomCode con "::" que no corresponde a ningún grupo conocido -> degrada a self, sin efecto de negocio', async () => {
      db.select.mockReturnValueOnce(chain([]));

      await expect(
        resolver.resolveGroupAnchor('RM_orphan-A', 'ghost-code::breakout-1'),
      ).resolves.toEqual({ parentSid: 'RM_orphan-A', parentCode: 'ghost-code::breakout-1' });
    });
  });

  describe('findExpiredBreakouts', () => {
    it('[4.2.8] proyección de filas abiertas con auto_close_at vencido', async () => {
      const now = new Date();
      const expiredRow = {
        id: 'b1',
        livekitRoomName: 'abc-defg-hij::breakout-1',
        autoCloseAt: new Date(now.getTime() - 60_000),
      };
      const activeRow = {
        id: 'b2',
        livekitRoomName: 'abc-defg-hij::breakout-2',
        autoCloseAt: new Date(now.getTime() + 60_000),
      };
      db.select.mockReturnValueOnce(chain([expiredRow, activeRow]));

      await expect(resolver.findExpiredBreakouts('room-1')).resolves.toEqual([expiredRow]);
    });
  });
});
