import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import type { DrizzleDb } from '../../db/drizzle.module';
import { callEvents } from '../../db/schema';
import { CallsWebhookService } from './calls-webhook.service';

const config = {
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: 'test-secret-at-least-32-characters-long',
};

// Construye un WebhookEvent "a mano": el servicio solo lee campos planos, no
// invoca métodos de la clase protobuf, así que un objeto simple alcanza.
function buildEvent(overrides: Record<string, unknown> = {}): WebhookEvent {
  return {
    id: 'evt-1',
    event: 'participant_joined',
    createdAt: BigInt(1700000000),
    room: { sid: 'RM_session-A', name: 'abc-defg-hij' },
    participant: { identity: 'guest-1' },
    ...overrides,
  } as unknown as WebhookEvent;
}

function createDbMock() {
  const returning = jest
    .fn<(cols: unknown) => Promise<{ id: string }[]>>()
    .mockResolvedValue([{ id: 'evt-1' }]);
  const onConflictDoNothing = jest.fn().mockReturnValue({ returning });
  const values = jest.fn().mockReturnValue({ onConflictDoNothing });
  const insert = jest.fn().mockReturnValue({ values });
  return { insert, values, onConflictDoNothing, returning };
}

describe('CallsWebhookService', () => {
  let db: ReturnType<typeof createDbMock>;
  let service: CallsWebhookService;
  let receive: jest.SpiedFunction<WebhookReceiver['receive']>;

  beforeEach(() => {
    db = createDbMock();
    service = new CallsWebhookService(new ConfigService(config), db as unknown as DrizzleDb);
    receive = jest.spyOn(WebhookReceiver.prototype, 'receive');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rechaza con 400 sin tocar la base ni la verificación de firma si falta rawBody', async () => {
    await expect(service.handle(undefined, 'any-sig')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(receive).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('rechaza con 400 si rawBody está vacío', async () => {
    await expect(service.handle(Buffer.alloc(0), 'any-sig')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(receive).not.toHaveBeenCalled();
  });

  it('rechaza con 401 si la firma es inválida o ausente, sin persistir nada', async () => {
    receive.mockRejectedValue(new Error('authorization header is empty'));
    await expect(service.handle(Buffer.from('{}'), undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('con firma válida, persiste el evento en call_events con los campos mapeados', async () => {
    receive.mockResolvedValue(buildEvent());
    await service.handle(Buffer.from('{"event":"participant_joined"}'), 'valid-sig');

    expect(db.insert).toHaveBeenCalledWith(callEvents);
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'evt-1',
        livekitRoomSid: 'RM_session-A',
        roomCode: 'abc-defg-hij',
        eventType: 'participant_joined',
        livekitIdentity: 'guest-1',
      }),
    );
  });

  it('entrega duplicada (insert sin filas afectadas) resuelve en 200 sin lanzar y sin reintentar el insert', async () => {
    receive.mockResolvedValue(buildEvent());
    db.returning.mockResolvedValue([]);

    await expect(service.handle(Buffer.from('{}'), 'valid-sig')).resolves.toBeUndefined();
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('acepta un tipo de evento no reconocido (p. ej. egress_started) sin error y lo persiste igual', async () => {
    receive.mockResolvedValue(buildEvent({ event: 'egress_started' }));

    await expect(
      service.handle(Buffer.from('{"event":"egress_started"}'), 'valid-sig'),
    ).resolves.toBeUndefined();
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'egress_started' }),
    );
  });

  it.each([
    'room_started',
    'room_finished',
    'participant_joined',
    'participant_left',
    'track_published',
    'track_unpublished',
  ])('despacha sin error el tipo de evento soportado %s', async (eventType) => {
    receive.mockResolvedValue(buildEvent({ event: eventType }));

    await expect(
      service.handle(Buffer.from(`{"event":"${eventType}"}`), 'valid-sig'),
    ).resolves.toBeUndefined();
  });

  it('track_published con source MICROPHONE persiste track_source = "microphone"', async () => {
    receive.mockResolvedValue(
      buildEvent({ event: 'track_published', track: { source: 2 /* MICROPHONE */ } }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ trackSource: 'microphone' }),
    );
  });

  it('dos sesiones de LiveKit distintas (mismo roomCode, distinto room.sid) guardan su propio livekit_room_sid sin mezclarse', async () => {
    receive.mockResolvedValueOnce(
      buildEvent({ room: { sid: 'RM_session-A', name: 'abc-defg-hij' } }),
    );
    await service.handle(Buffer.from('{}'), 'valid-sig');

    receive.mockResolvedValueOnce(
      buildEvent({ id: 'evt-2', room: { sid: 'RM_session-B', name: 'abc-defg-hij' } }),
    );
    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(db.values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ livekitRoomSid: 'RM_session-A', roomCode: 'abc-defg-hij' }),
    );
    expect(db.values).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ livekitRoomSid: 'RM_session-B', roomCode: 'abc-defg-hij' }),
    );
  });
});
