import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoomServiceClient } from 'livekit-server-sdk';
import { RoomEventsService } from '../rooms/room-events.service';
import { CallRoomTeardownService } from './call-room-teardown.service';

const config = {
  LIVEKIT_URL: 'wss://media.example.com',
  LIVEKIT_API_URL: 'http://localhost:7880',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: 'test-secret-at-least-32-characters-long',
};

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('CallRoomTeardownService', () => {
  let events: RoomEventsService;
  let deleteRoom: MockInstance<RoomServiceClient['deleteRoom']>;

  beforeEach(() => {
    events = new RoomEventsService();
    deleteRoom = vi.spyOn(RoomServiceClient.prototype, 'deleteRoom').mockResolvedValue(undefined);
    new CallRoomTeardownService(new ConfigService(config), events);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cierra la sala de LiveKit usando el código de la sala como nombre', async () => {
    events.emitRoomDeleted({ roomCode: 'ABC123' });
    await flush();

    expect(deleteRoom).toHaveBeenCalledTimes(1);
    expect(deleteRoom).toHaveBeenCalledWith('ABC123');
  });

  it('traga y registra el error cuando LiveKit no tiene la sala o no responde', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    deleteRoom.mockRejectedValue(new Error('requested room does not exist'));

    events.emitRoomDeleted({ roomCode: 'ABC123' });
    await flush();

    expect(deleteRoom).toHaveBeenCalledWith('ABC123');
    expect(log).toHaveBeenCalledTimes(1);
  });
});
