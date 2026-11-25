import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoomServiceClient, WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import type { DrizzleDb } from '../../db/drizzle.module';
import {
  callBreakoutRooms,
  callEvents,
  callHistory,
  callParticipantIdentities,
  callSessionParticipants,
  callSessions,
} from '../../db/schema';
import { chain } from '../../test-support/fake-drizzle';
import type { RoomEventsService } from '../rooms/room-events.service';
import type { CallSessionCloseService } from './call-session-close.service';
import { CallsWebhookService } from './calls-webhook.service';

function createCloseServiceMock() {
  return {
    onAdminLeft: vi.fn<CallSessionCloseService['onAdminLeft']>().mockResolvedValue(undefined),
    cancelPending: vi.fn<CallSessionCloseService['cancelPending']>(),
  };
}

// Decisión 2 (design.md "Señal de motivo de remoción", tasks.md 2.6): mismo
// puente que BreakoutRoomsService ya usa -- se verifica que el servicio
// emita la señal, no que ChatGateway la reciba (eso lo cubre
// chat.gateway.spec.ts).
function createRoomEventsMock() {
  return {
    emitBreakoutRemoval: vi.fn(),
  };
}

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
  const returning = vi
    .fn<(cols: unknown) => Promise<{ id: string }[]>>()
    .mockResolvedValue([{ id: 'evt-1' }]);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  // El rol actual de roomMembers se cruza con la identidad que salió.
  // — onParticipantLeft() resolviendo si el identity que se fue era admin.
  // Default: sin fila (no se encuentra ninguna correlación), así que el
  // dispatch de participant_left no llama a CallSessionCloseService salvo
  // que el test particular configure lo contrario.
  const select = vi.fn().mockReturnValue(chain([] as { role: string | null }[]));
  // Default genérico para cualquier dispatch que caiga en una transacción
  // (p. ej. room_finished) sin que el test particular configure su propio
  // tx: selects vacíos, compare-and-set sin filas -> no materializa nada,
  // no revienta.
  const transaction = vi
    .fn<(cb: (tx: unknown) => unknown) => Promise<unknown>>()
    .mockImplementation((cb) =>
      cb({
        select: vi.fn().mockReturnValue(chain([])),
        insert: vi.fn().mockReturnValue(chain(undefined)),
        update: vi.fn().mockReturnValue(chain([])),
      }),
    );
  const update = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue(chain(undefined)) });
  return { insert, values, onConflictDoNothing, returning, select, update, transaction };
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
  identities?: Array<{
    livekitIdentity: string;
    userId: string | null;
    displayName: string;
    roomId?: string | null;
  }>;
  claimed?: { id: string }[];
  // Fase 4 (D5.3, D6): filas de call_breakout_rooms que resuelven la
  // atribución de grupo del roomCode del evento (vacío por defecto -- sin
  // mini sala conocida, callGroupId queda null).
  breakoutRows?: Array<{ parentLivekitRoomSid: string | null }>;
}) {
  const sessionEvents = opts.sessionEvents ?? [];
  const identities = opts.identities ?? [];
  const claimed = opts.claimed ?? [{ id: 'session-1' }];
  const breakoutRows = opts.breakoutRows ?? [];

  const participantsInsertValues = vi
    .fn<(values: unknown) => Promise<void>>()
    .mockResolvedValue(undefined);
  const sessionInsertOnConflictDoNothing = vi
    .fn<(config: unknown) => Promise<void>>()
    .mockResolvedValue(undefined);
  const sessionInsertValues = vi
    .fn()
    .mockReturnValue({ onConflictDoNothing: sessionInsertOnConflictDoNothing });
  const updateReturning = vi
    .fn<(cols: unknown) => Promise<{ id: string }[]>>()
    .mockResolvedValue(claimed);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

  const select = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: unknown) => {
      if (table === callEvents) return chain(sessionEvents);
      if (table === callParticipantIdentities) return chain(identities);
      if (table === callBreakoutRooms) return chain(breakoutRows);
      return chain([]);
    }),
  }));

  const insert = vi.fn().mockImplementation((table: unknown) => {
    if (table === callSessions) return { values: sessionInsertValues };
    if (table === callSessionParticipants) return { values: participantsInsertValues };
    return { values: vi.fn() };
  });

  const update = vi.fn().mockImplementation((table: unknown) => {
    if (table === callSessions) return { set: updateSet };
    return { set: vi.fn() };
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
  let closeService: ReturnType<typeof createCloseServiceMock>;
  let roomEvents: ReturnType<typeof createRoomEventsMock>;
  let service: CallsWebhookService;
  let receive: MockInstance<WebhookReceiver['receive']>;

  beforeEach(() => {
    db = createDbMock();
    closeService = createCloseServiceMock();
    roomEvents = createRoomEventsMock();
    service = new CallsWebhookService(
      new ConfigService(config),
      db as unknown as DrizzleDb,
      closeService as unknown as CallSessionCloseService,
      roomEvents as unknown as RoomEventsService,
    );
    receive = vi.spyOn(WebhookReceiver.prototype, 'receive');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rechaza con 400 sin tocar la base ni la verificación de firma si falta rawBody', async () => {
    await expect(service.handle(undefined, 'any-sig')).rejects.toBeInstanceOf(BadRequestException);
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

    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ trackSource: 'microphone' }));
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
  let closeService: ReturnType<typeof createCloseServiceMock>;
  let roomEvents: ReturnType<typeof createRoomEventsMock>;
  let service: CallsWebhookService;
  let receive: MockInstance<WebhookReceiver['receive']>;

  beforeEach(() => {
    db = createDbMock();
    closeService = createCloseServiceMock();
    roomEvents = createRoomEventsMock();
    service = new CallsWebhookService(
      new ConfigService(config),
      db as unknown as DrizzleDb,
      closeService as unknown as CallSessionCloseService,
      roomEvents as unknown as RoomEventsService,
    );
    receive = vi.spyOn(WebhookReceiver.prototype, 'receive');
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    db.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
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

  it('room_finished cancela cualquier cierre forzado agendado para ese sid (Flujo 2, design.md)', async () => {
    const tx = createMaterializationTxMock({});
    db.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    receive.mockResolvedValue(
      buildEvent({ event: 'room_finished', room: { sid: 'RM_session-A', name: 'abc-defg-hij' } }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(closeService.cancelPending).toHaveBeenCalledWith('RM_session-A');
  });

  // R1 (design.md "R1 -- Admin sola que se traslada", tasks.md Fase 1):
  // caracterización obligatoria antes de tocar el evaluador de cierre --
  // room_finished de la PRINCIPAL nunca ejecuta la cascada
  // closeGroupBreakouts. Esa cascada solo se invoca desde
  // CallSessionCloseService.claimAndClose (ver
  // call-session-close.service.spec.ts, caso [5.7.7]); este archivo fija
  // que CallsWebhookService.onRoomFinished no tiene ningún camino hacia
  // ella.
  it('[R1-C5] room_finished de la principal nunca invoca la cascada de cierre de mini salas: su único contacto con el cierre forzado es cancelPending', async () => {
    const tx = createMaterializationTxMock({});
    db.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    receive.mockResolvedValue(
      buildEvent({ event: 'room_finished', room: { sid: 'RM_session-A', name: 'abc-defg-hij' } }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(closeService.cancelPending).toHaveBeenCalledWith('RM_session-A');
    expect(closeService.onAdminLeft).not.toHaveBeenCalled();
    // CallsWebhookService no tiene ninguna referencia a BreakoutRoomsService
    // (su única dependencia relacionada con cierre es CallSessionCloseService,
    // ya verificado arriba): estructuralmente no puede invocar
    // closeGroupBreakouts desde este camino. Si alguien lo conecta más
    // adelante (reproduciendo la tabla de Flujo 3 del diseño original), esta
    // aserción se rompe a propósito.
    expect(Object.keys(service as unknown as Record<string, unknown>)).not.toContain(
      'breakoutRooms',
    );
  });

  it('reentrega de room_finished (compare-and-set sin filas afectadas) no duplica el resumen (spec timeline/resiliencia-parcial)', async () => {
    const tx = createMaterializationTxMock({ claimed: [] });
    db.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    receive.mockResolvedValue(buildEvent({ event: 'room_finished' }));

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(tx.updateWhere).toHaveBeenCalled();
    expect(tx.participantsInsertValues).not.toHaveBeenCalled();
  });

  it('resuelve callSessions.roomId desde call_participant_identities, no desde una búsqueda por rooms.code (D4-D)', async () => {
    const sessionEvents = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: new Date('2026-11-06T10:00:00Z'),
      },
    ];
    const identities = [
      { livekitIdentity: 'id-a', userId: 'user-a', displayName: 'Ana', roomId: 'room-real' },
    ];
    const tx = createMaterializationTxMock({ sessionEvents, identities });
    db.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    receive.mockResolvedValue(buildEvent({ event: 'room_finished' }));

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(tx.sessionInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'room-real' }),
    );
  });

  it('cuando ningún identity conocido correlaciona, callSessions.roomId queda en null (columna ya nullable)', async () => {
    const sessionEvents = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-desconocido',
        trackSource: null,
        occurredAt: new Date('2026-11-06T10:00:00Z'),
      },
    ];
    const tx = createMaterializationTxMock({ sessionEvents, identities: [] });
    db.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    receive.mockResolvedValue(buildEvent({ event: 'room_finished' }));

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(tx.sessionInsertValues).toHaveBeenCalledWith(expect.objectContaining({ roomId: null }));
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
    db.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    receive.mockResolvedValue(buildEvent({ event: 'room_finished' }));

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(tx.insert).not.toHaveBeenCalledWith(callHistory);
    expect(tx.update).not.toHaveBeenCalledWith(callHistory);
  });

  // Fase 4 (design.md D5.3/D6; spec call-participation-timeline ADDED
  // "Vínculo de grupo..."; spec call-webhook-ingestion ADDED "Atribución de
  // eventos de mini sala..."): callGroupId stampeado en room_finished.

  it('[4.5.1/4.6.2] roomCode sin "::" (sala principal sin mini salas): callGroupId queda null, cero consultas nuevas a call_breakout_rooms', async () => {
    const sessionEvents = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: new Date('2026-11-06T10:00:00Z'),
      },
    ];
    const identities = [{ livekitIdentity: 'id-a', userId: 'user-a', displayName: 'Ana' }];
    const tx = createMaterializationTxMock({ sessionEvents, identities });
    db.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    receive.mockResolvedValue(
      buildEvent({ event: 'room_finished', room: { sid: 'RM_session-A', name: 'abc-defg-hij' } }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(tx.sessionInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ callGroupId: null }),
    );
    // Sin '::' en el roomCode, parseBreakoutRoomName corta antes de
    // cualquier select a callBreakoutRooms (D6: cero consultas nuevas).
    expect(tx.select).not.toHaveBeenCalledWith(callBreakoutRooms);
  });

  it('[4.5.2/4.6.1] roomCode con "::" que resuelve a un grupo conocido: callGroupId = parent_livekit_room_sid (atribución a la sala padre)', async () => {
    const sessionEvents = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: new Date('2026-11-06T10:00:00Z'),
      },
    ];
    const identities = [{ livekitIdentity: 'id-a', userId: 'user-a', displayName: 'Ana' }];
    const tx = createMaterializationTxMock({
      sessionEvents,
      identities,
      breakoutRows: [{ parentLivekitRoomSid: 'RM_parent-A' }],
    });
    db.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    receive.mockResolvedValue(
      buildEvent({
        event: 'room_finished',
        room: { sid: 'RM_breakout-A', name: 'abc-defg-hij::breakout-1' },
      }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(tx.sessionInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ callGroupId: 'RM_parent-A', roomCode: 'abc-defg-hij::breakout-1' }),
    );
  });

  it('[4.5.3] roomCode con "::" que no corresponde a ningún grupo conocido: se acepta sin error, callGroupId queda null (sin efecto de negocio)', async () => {
    const sessionEvents = [
      {
        eventType: 'participant_joined',
        livekitIdentity: 'id-a',
        trackSource: null,
        occurredAt: new Date('2026-11-06T10:00:00Z'),
      },
    ];
    const identities = [{ livekitIdentity: 'id-a', userId: 'user-a', displayName: 'Ana' }];
    const tx = createMaterializationTxMock({
      sessionEvents,
      identities,
      breakoutRows: [],
    });
    db.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));
    receive.mockResolvedValue(
      buildEvent({
        event: 'room_finished',
        room: { sid: 'RM_orphan-A', name: 'ghost-code::breakout-1' },
      }),
    );

    await expect(service.handle(Buffer.from('{}'), 'valid-sig')).resolves.toBeUndefined();

    expect(tx.sessionInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ callGroupId: null }),
    );
  });
});

describe('CallsWebhookService: cierre forzado en participant_left (tasks.md 6.10)', () => {
  let db: ReturnType<typeof createDbMock>;
  let closeService: ReturnType<typeof createCloseServiceMock>;
  let roomEvents: ReturnType<typeof createRoomEventsMock>;
  let service: CallsWebhookService;
  let receive: MockInstance<WebhookReceiver['receive']>;

  beforeEach(() => {
    db = createDbMock();
    closeService = createCloseServiceMock();
    roomEvents = createRoomEventsMock();
    service = new CallsWebhookService(
      new ConfigService(config),
      db as unknown as DrizzleDb,
      closeService as unknown as CallSessionCloseService,
      roomEvents as unknown as RoomEventsService,
    );
    receive = vi.spyOn(WebhookReceiver.prototype, 'receive');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('participant_left de un admin actual, incluso promovido durante la llamada, invoca el cierre', async () => {
    db.select.mockReturnValue(chain([{ role: 'administrador', roomId: 'room-parent-1' }]));
    receive.mockResolvedValue(
      buildEvent({
        event: 'participant_left',
        room: { sid: 'RM_session-A', name: 'abc-defg-hij' },
        participant: { identity: 'admin-1' },
      }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(closeService.onAdminLeft).toHaveBeenCalledWith(
      'RM_session-A',
      'abc-defg-hij',
      'room-parent-1',
    );
  });

  it('participant_left de un invitado o no-admin actual no invoca el cierre', async () => {
    db.select.mockReturnValue(chain([{ role: 'participante' }]));
    receive.mockResolvedValue(
      buildEvent({
        event: 'participant_left',
        room: { sid: 'RM_session-A', name: 'abc-defg-hij' },
        participant: { identity: 'guest-1' },
      }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(closeService.onAdminLeft).not.toHaveBeenCalled();
  });

  it('participant_left sin correlación de identidad conocida no invoca el cierre ni revienta', async () => {
    db.select.mockReturnValue(chain([]));
    receive.mockResolvedValue(
      buildEvent({
        event: 'participant_left',
        room: { sid: 'RM_session-A', name: 'abc-defg-hij' },
        participant: { identity: 'unknown-identity' },
      }),
    );

    await expect(service.handle(Buffer.from('{}'), 'valid-sig')).resolves.toBeUndefined();
    expect(closeService.onAdminLeft).not.toHaveBeenCalled();
  });
});

describe('CallsWebhookService: expulsión de ocupante locked en participant_joined (tasks.md 5.5.8/5.5.9)', () => {
  let db: ReturnType<typeof createDbMock>;
  let closeService: ReturnType<typeof createCloseServiceMock>;
  let roomEvents: ReturnType<typeof createRoomEventsMock>;
  let service: CallsWebhookService;
  let receive: MockInstance<WebhookReceiver['receive']>;
  let removeParticipant: MockInstance<RoomServiceClient['removeParticipant']>;

  beforeEach(() => {
    db = createDbMock();
    closeService = createCloseServiceMock();
    roomEvents = createRoomEventsMock();
    service = new CallsWebhookService(
      new ConfigService(config),
      db as unknown as DrizzleDb,
      closeService as unknown as CallSessionCloseService,
      roomEvents as unknown as RoomEventsService,
    );
    receive = vi.spyOn(WebhookReceiver.prototype, 'receive');
    removeParticipant = vi
      .spyOn(RoomServiceClient.prototype, 'removeParticipant')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('[5.5.8] participant_joined de la principal con una asignación abierta locked: expulsa al ocupante (D8 punto 2, ventana de fuga aceptada)', async () => {
    db.select.mockReturnValue(chain([{ occupantId: 'occ-1', leavePolicy: 'locked' }]));
    receive.mockResolvedValue(
      buildEvent({
        event: 'participant_joined',
        room: { sid: 'RM_session-A', name: 'abc-defg-hij' },
        participant: { identity: 'guest-locked' },
      }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(removeParticipant).toHaveBeenCalledWith('abc-defg-hij', 'guest-locked');
  });

  // Decisión 2 (design.md "Señal de motivo de remoción", tasks.md 2.6) +
  // spec call-webhook-ingestion "Señal explícita en la expulsión...locked":
  // señal propia, distinta de BREAKOUT_MOVE_IN/BREAKOUT_FORCED_RETURN, ANTES
  // de removeParticipant.
  it('[2.6] expulsión de ocupante locked emite breakout:removal con motivo BREAKOUT_RETURN_LOCKED antes de removeParticipant', async () => {
    db.select.mockReturnValue(chain([{ occupantId: 'occ-1', leavePolicy: 'locked' }]));
    receive.mockResolvedValue(
      buildEvent({
        event: 'participant_joined',
        room: { sid: 'RM_session-A', name: 'abc-defg-hij' },
        participant: { identity: 'guest-locked' },
      }),
    );
    const callOrder: string[] = [];
    roomEvents.emitBreakoutRemoval.mockImplementationOnce(() => {
      callOrder.push('emitBreakoutRemoval');
    });
    removeParticipant.mockImplementationOnce(() => {
      callOrder.push('removeParticipant');
      return Promise.resolve(undefined);
    });

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(roomEvents.emitBreakoutRemoval).toHaveBeenCalledWith({
      roomCode: 'abc-defg-hij',
      targetIdentity: 'guest-locked',
      reason: 'BREAKOUT_RETURN_LOCKED',
    });
    expect(callOrder).toEqual(['emitBreakoutRemoval', 'removeParticipant']);
  });

  it('[2.6] sin ninguna asignación abierta locked, no se emite ninguna señal de remoción', async () => {
    db.select.mockReturnValue(chain([]));
    receive.mockResolvedValue(
      buildEvent({
        event: 'participant_joined',
        room: { sid: 'RM_session-A', name: 'abc-defg-hij' },
        participant: { identity: 'guest-free' },
      }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(roomEvents.emitBreakoutRemoval).not.toHaveBeenCalled();
  });

  it('participant_joined de la principal sin ninguna asignación abierta locked no expulsa a nadie', async () => {
    db.select.mockReturnValue(chain([]));
    receive.mockResolvedValue(
      buildEvent({
        event: 'participant_joined',
        room: { sid: 'RM_session-A', name: 'abc-defg-hij' },
        participant: { identity: 'guest-free' },
      }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it('participant_joined de una MINI SALA (nombre con "::") nunca dispara esta regla, ni siquiera consulta la base', async () => {
    receive.mockResolvedValue(
      buildEvent({
        event: 'participant_joined',
        room: { sid: 'RM_breakout-1', name: 'abc-defg-hij::breakout-1' },
        participant: { identity: 'new-identity' },
      }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(removeParticipant).not.toHaveBeenCalled();
  });

  it('un administrador con asignación locked abierta que vuelve a la principal no es expulsado: se cierra su asignación', async () => {
    db.select
      .mockReturnValueOnce(chain([{ occupantId: 'occ-admin', leavePolicy: 'locked' }]))
      .mockReturnValueOnce(chain([{ role: 'administrador' }]));
    receive.mockResolvedValue(
      buildEvent({
        event: 'participant_joined',
        room: { sid: 'RM_session-A', name: 'abc-defg-hij' },
        participant: { identity: 'admin-sub' },
      }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(removeParticipant).not.toHaveBeenCalled();
    expect(roomEvents.emitBreakoutRemoval).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('un participant_joined que llega tarde y es anterior a la asignación no expulsa a nadie', async () => {
    db.select.mockReturnValueOnce(
      chain([
        {
          occupantId: 'occ-1',
          leavePolicy: 'locked',
          assignedAt: new Date((1700000000 + 30) * 1000),
        },
      ]),
    );
    receive.mockResolvedValue(
      buildEvent({
        event: 'participant_joined',
        createdAt: BigInt(1700000000),
        room: { sid: 'RM_session-A', name: 'abc-defg-hij' },
        participant: { identity: 'guest-locked' },
      }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(removeParticipant).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('quien vuelve a la principal desde una mini sala free_return queda marcado como devuelto, sin expulsión', async () => {
    db.select
      .mockReturnValueOnce(chain([{ occupantId: 'occ-2', leavePolicy: 'free_return' }]))
      .mockReturnValueOnce(chain([]));
    receive.mockResolvedValue(
      buildEvent({
        event: 'participant_joined',
        room: { sid: 'RM_session-A', name: 'abc-defg-hij' },
        participant: { identity: 'guest-free' },
      }),
    );

    await service.handle(Buffer.from('{}'), 'valid-sig');

    expect(removeParticipant).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('removeParticipant falla: no relanza, el webhook sigue resolviendo en 200', async () => {
    db.select.mockReturnValue(chain([{ occupantId: 'occ-1', leavePolicy: 'locked' }]));
    removeParticipant.mockRejectedValue(new Error('participant not found'));
    receive.mockResolvedValue(
      buildEvent({
        event: 'participant_joined',
        room: { sid: 'RM_session-A', name: 'abc-defg-hij' },
        participant: { identity: 'guest-locked' },
      }),
    );

    await expect(service.handle(Buffer.from('{}'), 'valid-sig')).resolves.toBeUndefined();
  });
});
