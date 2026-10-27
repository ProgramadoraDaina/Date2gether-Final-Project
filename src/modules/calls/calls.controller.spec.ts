import { describe, expect, it, jest } from '@jest/globals';
import type { ParticipantRequest } from '../auth/guards/room-access.guard';
import { CallsController } from './calls.controller';
import type { CallsService } from './calls.service';

describe('CallsController', () => {
  it('usa la identidad y el nombre del pase verificado para emitir la sesión LiveKit', async () => {
    const session = {
      url: 'wss://media.example.com',
      token: 'signed-token',
      roomName: 'abc-defg-hij',
      participantLimit: 6,
    };
    const service = { join: jest.fn<CallsService['join']>().mockResolvedValue(session) };
    const controller = new CallsController(service as unknown as CallsService);
    const request = {
      participant: {
        kind: 'room-participant',
        sub: 'guest-123',
        roomCode: 'abc-defg-hij',
        name: 'Alex',
      },
    } as ParticipantRequest;
    await expect(controller.join('abc-defg-hij', request)).resolves.toEqual(session);
    expect(service.join).toHaveBeenCalledWith('abc-defg-hij', request.participant);
    const handler = Object.getOwnPropertyDescriptor(CallsController.prototype, 'join')!
      .value as object;
    expect(Reflect.getMetadata('__headers__', handler)).toContainEqual({
      name: 'Cache-Control',
      value: 'no-store',
    });
  });
});
