import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import type { DrizzleDb } from '../../db/drizzle.module';
import {
  callEvents,
  callHistory,
  callParticipantIdentities,
  callSessionParticipants,
  callSessions,
  rooms,
} from '../../db/schema';
import { chain } from '../../test-support/fake-drizzle';
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
  // Default genérico para cualquier dispatch que caiga en una transacción
  // (p. ej. room_finished) sin que el test particular configure su propio
  // tx: selects vacíos, compare-and-set sin filas -> no materializa nada,
  // no revienta.
  const transaction = jest
    .fn<(cb: (tx: unknown) => unknown) => Promise<unknown>>()
    .mockImplementation(async (cb) =>
      cb({
        select: jest.fn().mockReturnValue(chain([])),
        insert: jest.fn().mockReturnValue(chain(undefined)),
        update: jest.fn().mockReturnValue(chain([])),
      }),
    );
  return { insert, values, onConflictDoNothing, returning, transaction };
}

// tx dedicado para los tests de materialización en room_finished: cada tabla
// enruta a un resultado distinto, como hace Drizzle de verdad.
function createMaterializationTxMock(opts: {
  sessionEvents?: Array<{
    eventType: string;
    livekitIdentity: string | null;
    trackSource: string | null;
    occurredAt: Date;
  }>;
  identities?: Array<{ livekitIdentity: string; userId: string | null; displayName: string }>;
  room?: { id: string } | null;
  claimed?: { id: string }[];
}) {
  const sessionEvents = opts.sessionEvents ?? [];
  const identities = opts.identities ?? [];
  const room = opts.room === undefined ? { id: 'room-1' } : opts.room;
  const claimed = opts.claimed ?? [{ id: 'session-1' }];

  const participantsInsertValues = jest
    .fn<(values: unknown) => Promise<void>>()
    .mockResolvedValue(undefined);
  const sessionInsertOnConflictDoNothing = jest
    .fn<(config: unknown) => Promise<void>>()
    .mockResolvedValue(undefined);
  const sessionInsertValues = jest
    .fn()
    .mockReturnValue({ onConflictDoNothing: sessionInsertOnConflictDoNothing });
  const updateReturning = jest
    .fn<(cols: unknown) => Promise<{ id: string }[]>>()
    .mockResolvedValue(claimed);
  const updateWhere = jest.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });

  const select = jest.fn().mockImplementation(() => ({
    from: jest.fn().mockImplementation((table: unknown) => {
      if (table === callEvents) return chain(sessionEvents);
      if (table === callParticipantIdentities) return chain(identities);
      if (table === rooms) return chain(room ? [room] : []);
      return chain([]);
    }),
  }));

  const insert = jest.fn().mockImplementation((table: unknown) => {
    if (table === callSessions) return { values: sessionInsertValues };
    if (table === callSessionParticipants) return { values: participantsInsertValues };
    return { values: jest.fn() };
  });

  const update = jest.fn().mockImplementation((table: unknown) => {
    if (table === callSessions) return { set: updateSet };
    return { set: jest.fn() };
  });

  return {
    select,
    insert,
    update,
    sessionInsertValues,
    sessionInsertOnConflictDoNothing,
    participantsInsertValues,
    updateSet,
    updateWhere,
    updateReturning,
  };
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

describe('CallsWebhookService: materialización en room_finished', () => {
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

  it('con materialized_at IS NULL: agrega el log crudo y materializa call_session_participants en una sola transacción (spec timeline/materialización)', async () => {
    const sessionEvents = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: new Date('2026-11-06T10:00:00Z'),
      },
      {
        eventType: 'participant_left',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: new Date('2026-11-06T10:05:00Z'),
      },
    ];
    const identities = [{ livekitIdentity: 'id-a', userId: 'user-a', displayName: 'Ana' }];
    const tx = createMaterializationTxMock({ sessionEvents, identities });
    db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
    receive.mockResolvedValue(buildEvent({ event: 'room_finished' }));

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledWith(callSessions);
    expect(tx.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ materializedAt: expect.any(Date), endedAt: expect.any(Date) }),
    );
    expect(tx.insert).toHaveBeenCalledWith(callSessionParticipants);
    expect(tx.participantsInsertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        sessionId: 'session-1',
        participantKey: 'user-a',
        displayName: 'Ana',
        totalSeconds: 300,
      }),
    ]);
  });

  it('reentrega de room_finished (compare-and-set sin filas afectadas) no duplica el resumen (spec timeline/resiliencia-parcial)', async () => {
    const tx = createMaterializationTxMock({ claimed: [] });
    db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
    receive.mockResolvedValue(buildEvent({ event: 'room_finished' }));

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(tx.updateWhere).toHaveBeenCalled();
    expect(tx.participantsInsertValues).not.toHaveBeenCalled();
  });

  it('regresión: materializar la sesión no toca call_history (spec timeline/independencia-callHistory)', async () => {
    const sessionEvents = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: new Date('2026-11-06T10:00:00Z'),
      },
      {
        eventType: 'participant_left',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: new Date('2026-11-06T10:05:00Z'),
      },
    ];
    const identities = [{ livekitIdentity: 'id-a', userId: 'user-a', displayName: 'Ana' }];
    const tx = createMaterializationTxMock({ sessionEvents, identities });
    db.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
    receive.mockResolvedValue(buildEvent({ event: 'room_finished' }));

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(tx.insert).not.toHaveBeenCalledWith(callHistory);
    expect(tx.update).not.toHaveBeenCalledWith(callHistory);
  });
});
