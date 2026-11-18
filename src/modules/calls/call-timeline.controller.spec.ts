import { describe, expect, it, jest } from '@jest/globals';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CallTimelineController } from './call-timeline.controller';
import type { CallTimelineService } from './call-timeline.service';

describe('CallTimelineController', () => {
  it('requiere autenticación de cuenta', () => {
    const guards = (Reflect.getMetadata('__guards__', CallTimelineController) ?? []) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('GET /calls/sessions delega en CallTimelineService.listSessions con el id del usuario autenticado', async () => {
    const sessions = [
      {
        id: 'session-1',
        roomCode: 'abc-defg-hij',
        roomName: 'Reunión',
        startedAt: new Date(),
        endedAt: null,
        participantCount: 2,
      },
    ];
    const service = {
      listSessions: jest.fn<CallTimelineService['listSessions']>().mockResolvedValue(sessions),
    };
    const controller = new CallTimelineController(service as unknown as CallTimelineService);

    const result = await controller.listSessions({ sub: 'user-1', email: 'a@example.test' });

    expect(result).toEqual(sessions);
    expect(service.listSessions).toHaveBeenCalledWith('user-1');
  });

  it('GET /calls/sessions/:sessionId/timeline delega en CallTimelineService.getSessionTimeline con el sessionId y el id del usuario autenticado', async () => {
    const timeline = {
      id: 'session-1',
      roomCode: 'abc-defg-hij',
      roomName: 'Reunión',
      startedAt: new Date(),
      endedAt: null,
      participants: [],
    };
    const service = {
      getSessionTimeline: jest
        .fn<CallTimelineService['getSessionTimeline']>()
        .mockResolvedValue(timeline),
    };
    const controller = new CallTimelineController(service as unknown as CallTimelineService);

    const result = await controller.getSessionTimeline('session-1', {
      sub: 'user-1',
      email: 'a@example.test',
    });

    expect(result).toEqual(timeline);
    expect(service.getSessionTimeline).toHaveBeenCalledWith('session-1', 'user-1');
  });
});
