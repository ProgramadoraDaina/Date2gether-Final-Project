import { describe, expect, it, jest } from '@jest/globals';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CallsWebhookController } from './calls-webhook.controller';
import type { CallsWebhookService } from './calls-webhook.service';

describe('CallsWebhookController', () => {
  it('lee el rawBody y el header Authorize solo vía @Req(), y delega en el servicio', async () => {
    const webhookService = {
      handle: jest.fn<CallsWebhookService['handle']>().mockResolvedValue(undefined),
    };
    const controller = new CallsWebhookController(
      webhookService as unknown as CallsWebhookService,
    );
    const req = {
      rawBody: Buffer.from('{"event":"room_started"}'),
      headers: { authorize: 'signed-jwt' },
    } as unknown as RawBodyRequest<Request>;

    await controller.handle(req);

    expect(webhookService.handle).toHaveBeenCalledWith(req.rawBody, 'signed-jwt');
  });

  it(
    'expone @SkipThrottle() a nivel de clase (el ThrottlerGuard global no debe aplicar) ' +
      'y @HttpCode(200) en el handler',
    () => {
      // 'THROTTLER:SKIPdefault' y '__httpCode__' son las claves de metadata
      // internas de @nestjs/throttler y @nestjs/common respectivamente (mismo
      // patrón usado en calls.controller.spec.ts con '__headers__').
      expect(Reflect.getMetadata('THROTTLER:SKIPdefault', CallsWebhookController)).toBe(true);
      const handler = Object.getOwnPropertyDescriptor(CallsWebhookController.prototype, 'handle')!
        .value as object;
      expect(Reflect.getMetadata('__httpCode__', handler)).toBe(200);
    },
  );
});
