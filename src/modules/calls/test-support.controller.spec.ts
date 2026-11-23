import { NotFoundException } from '@nestjs/common';
import { RoomServiceClient, type ParticipantInfo } from 'livekit-server-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { TestSupportController } from './test-support.controller';

// [7.1] Endpoint exclusivo de la suite E2E: expone listParticipants de
// LiveKit, gateado por NODE_ENV==='test'. Ver test-support.controller.ts.
function buildConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('TestSupportController', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it('[7.1] fuera de NODE_ENV=test responde 404, sin consultar LiveKit', async () => {
    process.env.NODE_ENV = 'development';
    const listParticipants = vi.spyOn(RoomServiceClient.prototype, 'listParticipants');
    const controller = new TestSupportController(
      buildConfig({
        LIVEKIT_URL: 'ws://localhost:7880',
        LIVEKIT_API_KEY: 'devkey',
        LIVEKIT_API_SECRET: 'devsecret',
      }),
    );

    await expect(controller.listParticipants('abc-defg-hij')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(listParticipants).not.toHaveBeenCalled();
  });

  it('[7.1] en NODE_ENV=test devuelve las identities de listParticipants', async () => {
    process.env.NODE_ENV = 'test';
    vi.spyOn(RoomServiceClient.prototype, 'listParticipants').mockResolvedValue([
      { identity: 'p1' },
      { identity: 'p2' },
    ] as unknown as ParticipantInfo[]);
    const controller = new TestSupportController(
      buildConfig({
        LIVEKIT_URL: 'ws://localhost:7880',
        LIVEKIT_API_URL: 'http://localhost:7880',
        LIVEKIT_API_KEY: 'devkey',
        LIVEKIT_API_SECRET: 'devsecret',
      }),
    );

    const result = await controller.listParticipants('abc-defg-hij::breakout-1');

    expect(result).toEqual({ identities: ['p1', 'p2'] });
  });

  it('[7.1] en NODE_ENV=test sin configuración de LiveKit devuelve vacío, sin tirar', async () => {
    process.env.NODE_ENV = 'test';
    const listParticipants = vi.spyOn(RoomServiceClient.prototype, 'listParticipants');
    const controller = new TestSupportController(buildConfig({}));

    const result = await controller.listParticipants('abc-defg-hij');

    expect(result).toEqual({ identities: [] });
    expect(listParticipants).not.toHaveBeenCalled();
  });

  it('[7.1] en NODE_ENV=test, una sala inexistente/reapeada devuelve vacío en vez de tirar', async () => {
    process.env.NODE_ENV = 'test';
    vi.spyOn(RoomServiceClient.prototype, 'listParticipants').mockRejectedValue(
      new Error('not found'),
    );
    const controller = new TestSupportController(
      buildConfig({
        LIVEKIT_URL: 'ws://localhost:7880',
        LIVEKIT_API_KEY: 'devkey',
        LIVEKIT_API_SECRET: 'devsecret',
      }),
    );

    const result = await controller.listParticipants('abc-defg-hij::breakout-9');

    expect(result).toEqual({ identities: [] });
  });
});
