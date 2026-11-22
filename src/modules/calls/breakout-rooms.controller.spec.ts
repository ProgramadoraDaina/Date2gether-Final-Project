import { describe, expect, it, vi } from 'vitest';
import type { ParticipantRequest } from '../auth/guards/room-access.guard';
import { RoomAccessGuard } from '../auth/guards/room-access.guard';
import { BreakoutRoomsController } from './breakout-rooms.controller';
import type { BreakoutRoomsService } from './breakout-rooms.service';

function buildRequest(overrides: Partial<ParticipantRequest> = {}): ParticipantRequest {
  return {
    room: { id: 'room-1', code: 'abc-defg-hij' },
    participant: {
      kind: 'room-participant',
      sub: 'guest-123',
      roomId: 'room-1',
      roomCode: 'abc-defg-hij',
      name: 'Alex',
    },
    ...overrides,
  } as unknown as ParticipantRequest;
}

describe('BreakoutRoomsController', () => {
  it('[5.8.2] aplica RoomAccessGuard a nivel de controlador', () => {
    const guards = (Reflect.getMetadata('__guards__', BreakoutRoomsController) ?? []) as unknown[];
    expect(guards).toContain(RoomAccessGuard);
  });

  it('[5.8.3] create delega en BreakoutRoomsService.create con roomId/roomCode/participant/dto', async () => {
    const service = { create: vi.fn().mockResolvedValue({ id: 'breakout-1' }) };
    const controller = new BreakoutRoomsController(service as unknown as BreakoutRoomsService);
    const request = buildRequest();
    const dto = { label: 'Equipo A' };

    const result = await controller.create(request, dto);

    expect(result).toEqual({ id: 'breakout-1' });
    expect(service.create).toHaveBeenCalledWith('room-1', 'abc-defg-hij', request.participant, dto);
  });

  it('[5.8.3] list delega en BreakoutRoomsService.list con roomId/participant', async () => {
    const service = { list: vi.fn().mockResolvedValue([]) };
    const controller = new BreakoutRoomsController(service as unknown as BreakoutRoomsService);
    const request = buildRequest();

    await controller.list(request);

    expect(service.list).toHaveBeenCalledWith('room-1', request.participant);
  });

  it('[5.8.3] updatePolicy delega con breakoutId/roomId/participant/dto', async () => {
    const service = { updatePolicy: vi.fn().mockResolvedValue({ id: 'breakout-1' }) };
    const controller = new BreakoutRoomsController(service as unknown as BreakoutRoomsService);
    const request = buildRequest();
    const dto = { leavePolicy: 'free_return' as const };

    await controller.updatePolicy(request, 'breakout-1', dto);

    expect(service.updatePolicy).toHaveBeenCalledWith(
      'breakout-1',
      'room-1',
      request.participant,
      dto,
    );
  });

  it('[5.8.3] moveIn delega con breakoutId/roomId/participant/dto', async () => {
    const service = { moveIn: vi.fn().mockResolvedValue({ targetIdentity: 'new-id' }) };
    const controller = new BreakoutRoomsController(service as unknown as BreakoutRoomsService);
    const request = buildRequest();
    const dto = { livekitIdentity: 'guest-sub' };

    await controller.moveIn(request, 'breakout-1', dto);

    expect(service.moveIn).toHaveBeenCalledWith('breakout-1', 'room-1', request.participant, dto);
  });

  it('[5.8.3] issueToken delega con breakoutId/roomId/participant', async () => {
    const service = {
      issueBreakoutToken: vi
        .fn()
        .mockResolvedValue({ url: '', token: '', roomName: '', participantLimit: 6 }),
    };
    const controller = new BreakoutRoomsController(service as unknown as BreakoutRoomsService);
    const request = buildRequest();

    await controller.issueToken(request, 'breakout-1');

    expect(service.issueBreakoutToken).toHaveBeenCalledWith(
      'breakout-1',
      'room-1',
      request.participant,
    );
  });

  it('[5.8.3] selfReturn delega con breakoutId/roomId/participant/livekitIdentity opcional', async () => {
    const service = { selfReturn: vi.fn().mockResolvedValue(undefined) };
    const controller = new BreakoutRoomsController(service as unknown as BreakoutRoomsService);
    const request = buildRequest();

    await controller.selfReturn(request, 'breakout-1', { livekitIdentity: 'occ-identity' });

    expect(service.selfReturn).toHaveBeenCalledWith(
      'breakout-1',
      'room-1',
      request.participant,
      'occ-identity',
    );
  });

  it('[5.8.3] close delega con breakoutId/roomId/participant/"manual"', async () => {
    const service = { close: vi.fn().mockResolvedValue(undefined) };
    const controller = new BreakoutRoomsController(service as unknown as BreakoutRoomsService);
    const request = buildRequest();

    await controller.close(request, 'breakout-1');

    expect(service.close).toHaveBeenCalledWith(
      'breakout-1',
      'room-1',
      request.participant,
      'manual',
    );
  });

  it('[5.8.3] closeAll delega con roomId/participant', async () => {
    const service = { closeAll: vi.fn().mockResolvedValue(undefined) };
    const controller = new BreakoutRoomsController(service as unknown as BreakoutRoomsService);
    const request = buildRequest();

    await controller.closeAll(request);

    expect(service.closeAll).toHaveBeenCalledWith('room-1', request.participant);
  });
});
