import { describe, expect, it, jest } from '@jest/globals';
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
    const entries = [{ roomCode: 'abc-defg-hij', roomName: 'Reunión', startedAt: new Date() }];
    const service = {
      listHistory: jest.fn<CallsService['listHistory']>().mockResolvedValue(entries),
    };
    const controller = new CallHistoryController(service as unknown as CallsService);

    const result = await controller.list({ sub: 'user-1', email: 'a@example.test' });

    expect(result).toEqual(entries);
    expect(service.listHistory).toHaveBeenCalledWith('user-1');
  });
});
