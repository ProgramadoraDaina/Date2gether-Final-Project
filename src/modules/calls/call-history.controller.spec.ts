import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CallHistoryController } from './call-history.controller';
import type { CallsService } from './calls.service';

describe('CallHistoryController', () => {
  it('requiere autenticación de cuenta', () => {
    const handler = Object.getOwnPropertyDescriptor(CallHistoryController.prototype, 'list')!
      .value as object;
    const guards = (Reflect.getMetadata('__guards__', CallHistoryController) ?? []) as unknown[];
    const methodGuards = (Reflect.getMetadata('__guards__', handler) ?? []) as unknown[];
    expect([...guards, ...methodGuards]).toContain(JwtAuthGuard);
  });

  it('delega en CallsService.listHistory con el id del usuario autenticado', async () => {
    const entries = [
      {
        roomId: 'room-1',
        roomCode: 'abc-defg-hij',
        roomName: 'Reunión',
        startedAt: new Date(),
        sessionId: null,
      },
    ];
    const service = {
      listHistory: vi.fn<CallsService['listHistory']>().mockResolvedValue(entries),
    };
    const controller = new CallHistoryController(service as unknown as CallsService);

    const result = await controller.list({ sub: 'user-1', email: 'a@example.test' });

    expect(result).toEqual(entries);
    expect(service.listHistory).toHaveBeenCalledWith('user-1');
  });

  it('delega en CallsService.getRoomNotesForHistory con el usuario y el roomId (D4-C: no el código)', async () => {
    const notes = { roomId: 'room-1', content: 'hola', revision: 1, updatedAt: new Date() };
    const service = {
      getRoomNotesForHistory: vi
        .fn<CallsService['getRoomNotesForHistory']>()
        .mockResolvedValue(notes),
    };
    const controller = new CallHistoryController(service as unknown as CallsService);

    const result = await controller.notes({ sub: 'user-1', email: 'a@example.test' }, 'room-1');

    expect(result).toEqual(notes);
    expect(service.getRoomNotesForHistory).toHaveBeenCalledWith('user-1', 'room-1');
  });
});
