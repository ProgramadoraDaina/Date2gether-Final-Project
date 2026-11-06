import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import type { DrizzleDb } from '../../db/drizzle.module';
import { chain } from '../../test-support/fake-drizzle';
import { CallTimelineService } from './call-timeline.service';

describe('CallTimelineService', () => {
  describe('listSessions', () => {
    it('devuelve solo las sesiones donde participó el solicitante, con roomName y participantCount', async () => {
      const select = jest
        .fn()
        // 1) sesiones donde el solicitante aparece como participante
        .mockReturnValueOnce(chain([{ sessionId: 'session-1' }]))
        // 2) cabecera de esas sesiones (join a rooms por roomName)
        .mockReturnValueOnce(
          chain([
            {
              id: 'session-1',
              roomCode: 'abc-defg-hij',
              roomName: 'Reunión',
              startedAt: new Date('2026-01-01T10:00:00Z'),
              endedAt: new Date('2026-01-01T10:30:00Z'),
            },
          ]),
        )
        // 3) todas las filas de participantes de esas sesiones, para el conteo
        .mockReturnValueOnce(
          chain([
            { sessionId: 'session-1' },
            { sessionId: 'session-1' },
            { sessionId: 'session-1' },
          ]),
        );
      const db = { select } as unknown as DrizzleDb;
      const service = new CallTimelineService(db);

      const result = await service.listSessions('user-1');

      expect(result).toEqual([
        {
          id: 'session-1',
          roomCode: 'abc-defg-hij',
          roomName: 'Reunión',
          startedAt: new Date('2026-01-01T10:00:00Z'),
          endedAt: new Date('2026-01-01T10:30:00Z'),
          participantCount: 3,
        },
      ]);
      expect(select).toHaveBeenCalledTimes(3);
    });

    it('no consulta sesiones si el solicitante no participó de ninguna (corta antes)', async () => {
      const select = jest.fn().mockReturnValueOnce(chain([]));
      const db = { select } as unknown as DrizzleDb;
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
      const select = jest
        .fn()
        .mockReturnValueOnce(chain(participantRows))
        .mockReturnValueOnce(chain([sessionHeaderRow]));
      const db = { select } as unknown as DrizzleDb;
      const service = new CallTimelineService(db);

      const result = await service.getSessionTimeline('session-1', 'user-1');

      expect(result).toEqual({ ...sessionHeaderRow, participants: participantRows });
    });

    it('un usuario ajeno a la sesión recibe 404, no 403, y no se consulta la cabecera', async () => {
      const participantRows = [
        {
          participantKey: 'user-2',
          userId: 'user-2',
          displayName: 'Carla',
          isGuest: false,
          firstJoinedAt: new Date(),
          lastLeftAt: new Date(),
          totalSeconds: 60,
          spoke: false,
          screenShared: false,
          rejoinCount: 0,
          nameColor: null,
        },
      ];
      const select = jest.fn().mockReturnValueOnce(chain(participantRows));
      const db = { select } as unknown as DrizzleDb;
      const service = new CallTimelineService(db);

      await expect(service.getSessionTimeline('session-1', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(select).toHaveBeenCalledTimes(1);
    });

    it('un sessionId inexistente recibe el mismo 404 que un usuario ajeno (no filtra existencia)', async () => {
      const select = jest.fn().mockReturnValueOnce(chain([]));
      const db = { select } as unknown as DrizzleDb;
      const service = new CallTimelineService(db);

      await expect(
        service.getSessionTimeline('session-inexistente', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(select).toHaveBeenCalledTimes(1);
    });
  });
});
