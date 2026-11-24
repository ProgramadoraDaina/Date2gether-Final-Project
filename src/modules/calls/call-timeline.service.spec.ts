import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { DrizzleDb } from '../../db/drizzle.module';
import { chain } from '../../test-support/fake-drizzle';
import { CallTimelineService } from './call-timeline.service';

describe('CallTimelineService', () => {
  describe('listSessions', () => {
    it('devuelve solo las sesiones donde participó el solicitante, con roomName y participantCount', async () => {
      const rows = [
        {
          id: 'session-1',
          roomCode: 'abc-defg-hij',
          roomName: 'Reunión',
          startedAt: new Date('2026-01-01T10:00:00Z'),
          endedAt: new Date('2026-01-01T10:30:00Z'),
          participantCount: 3,
        },
      ];
      const query = chain(rows);
      const select = vi.fn().mockReturnValueOnce(query);
      const db = { select, $count: vi.fn() } as unknown as DrizzleDb;
      const service = new CallTimelineService(db);

      await expect(service.listSessions('user-1')).resolves.toEqual(rows);
      expect(select).toHaveBeenCalledTimes(1);
      expect(query.limit).toHaveBeenCalledWith(50);
    });

    it('devuelve una lista vacía si el solicitante no tiene sesiones recientes', async () => {
      const select = vi.fn().mockReturnValueOnce(chain([]));
      const db = { select, $count: vi.fn() } as unknown as DrizzleDb;
      const service = new CallTimelineService(db);

      const result = await service.listSessions('user-sin-sesiones');

      expect(result).toEqual([]);
      expect(select).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSessionTimeline', () => {
    it('un participante de la sesión ve el resumen completo de todos los participantes, incluidos invitados', async () => {
      const participantRows = [
        {
          participantKey: 'user-1',
          userId: 'user-1',
          displayName: 'Ana',
          isGuest: false,
          firstJoinedAt: new Date('2026-01-01T10:00:00Z'),
          lastLeftAt: new Date('2026-01-01T10:30:00Z'),
          totalSeconds: 1800,
          spoke: true,
          screenShared: false,
          rejoinCount: 0,
          nameColor: 'purple',
        },
        {
          participantKey: 'guest:bob',
          userId: null,
          displayName: 'Bob',
          isGuest: true,
          firstJoinedAt: new Date('2026-01-01T10:05:00Z'),
          lastLeftAt: new Date('2026-01-01T10:20:00Z'),
          totalSeconds: 900,
          spoke: false,
          screenShared: true,
          rejoinCount: 0,
          nameColor: null,
        },
      ];
      const sessionHeaderRow = {
        id: 'session-1',
        roomCode: 'abc-defg-hij',
        roomName: 'Reunión',
        startedAt: new Date('2026-01-01T10:00:00Z'),
        endedAt: new Date('2026-01-01T10:30:00Z'),
      };
      const select = vi
        .fn()
        .mockReturnValueOnce(chain([sessionHeaderRow]))
        .mockReturnValueOnce(chain(participantRows));
      const db = { select } as unknown as DrizzleDb;
      const service = new CallTimelineService(db);

      const result = await service.getSessionTimeline('session-1', 'user-1');

      expect(result).toEqual({ ...sessionHeaderRow, participants: participantRows });
    });

    it('un usuario ajeno a la sesión recibe 404 sin consultar los participantes', async () => {
      const select = vi.fn().mockReturnValueOnce(chain([]));
      const db = { select } as unknown as DrizzleDb;
      const service = new CallTimelineService(db);

      await expect(service.getSessionTimeline('session-1', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(select).toHaveBeenCalledTimes(1);
    });

    it('un sessionId inexistente recibe el mismo 404 que un usuario ajeno (no filtra existencia)', async () => {
      const select = vi.fn().mockReturnValueOnce(chain([]));
      const db = { select } as unknown as DrizzleDb;
      const service = new CallTimelineService(db);

      await expect(
        service.getSessionTimeline('session-inexistente', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(select).toHaveBeenCalledTimes(1);
    });
  });
});
