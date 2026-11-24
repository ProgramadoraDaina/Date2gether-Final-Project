import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { AccessTokenPayload } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TranscriptHistoryController } from './transcript-history.controller';
import type { TranscriptHistoryService } from './transcript-history.service';

const user = { sub: 'user-1' } as AccessTokenPayload;

describe('TranscriptHistoryController', () => {
  it('solo responde a cuentas registradas y pasa el usuario del token, no uno del pedido', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TranscriptHistoryController)).toEqual([
      JwtAuthGuard,
    ]);
    const service = {
      getForSession: vi.fn<TranscriptHistoryService['getForSession']>().mockResolvedValue([]),
      resolveBySid: vi
        .fn<TranscriptHistoryService['resolveBySid']>()
        .mockResolvedValue({ id: 'session-1' }),
    };
    const controller = new TranscriptHistoryController(
      service as unknown as TranscriptHistoryService,
    );

    await expect(controller.getForSession('session-1', user)).resolves.toEqual([]);
    expect(service.getForSession).toHaveBeenCalledWith('session-1', 'user-1');
    await expect(controller.resolveBySid('RM_abc', user)).resolves.toEqual({ id: 'session-1' });
    expect(service.resolveBySid).toHaveBeenCalledWith('RM_abc', 'user-1');
  });
});
