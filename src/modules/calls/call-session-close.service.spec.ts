import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { RoomServiceClient, type ParticipantInfo } from 'livekit-server-sdk';
import type { DrizzleDb } from '../../db/drizzle.module';
import {
  callBreakoutOccupants,
  callBreakoutRooms,
  callEvents,
  callParticipantIdentities,
  callSessions,
  roomMembers,
} from '../../db/schema';
import { chain } from '../../test-support/fake-drizzle';
import type { BreakoutRoomsService } from './breakout-rooms.service';
import type { CallGroupResolverService } from './call-group-resolver.service';
import { CallSessionCloseService } from './call-session-close.service';

const config = {
  LIVEKIT_URL: 'wss://media.example.com',
  LIVEKIT_API_URL: 'http://localhost:7880',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: 'test-secret-at-least-32-characters-long',
};

function createDbMock() {
  // select(...).from(table).where(...).limit(1) — enrutado por tabla, mismo
  // patrón que calls-webhook.service.spec.ts. Dos usos posibles: (a)
  // callEvents en ensureSessionRow() — default sin eventos (startedAt cae al
  // fallback new Date()); (b) callParticipantIdentities, compartida por
  // hasConnectedAdmin() (sin fila = sin admin conectado) y por
  // ensureSessionRow() (sin fila = roomId queda null, D4-D) — default sin
  // fila en ambos casos.
  const select = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: unknown) => {
      if (table === callEvents)
        return chain([] as { occurredAt: Date; livekitIdentity: string | null }[]);
      // hasAdminAssignmentInFlight (R1, Fase 1): join de tres tablas
      // encabezado por callBreakoutOccupants. Default: sin fila (ningún
      // admin en tránsito), para que ningún test preexistente que llegue a
      // este branch sin configurarlo explícitamente asuma lo contrario.
      if (table === callBreakoutOccupants) return chain([] as { id: string }[]);
      return chain([] as { id: string; roomId: string | null }[]); // callParticipantIdentities
    }),
  }));

  // insert(callSessions).values(...).onConflictDoNothing() — creación
  // perezosa de la cabecera de sesión (ver claimAndClose/ensureSessionRow).
  // Default: no-op exitoso, sin modelar si la fila ya existía o no.
  const insertValues = vi.fn().mockReturnValue({
    onConflictDoNothing: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  // update(callSessions).set(...).where(...).returning(...) — claimAndClose().
  // Default: compare-and-set gana (1 fila devuelta).
  const updateReturning = vi
    .fn<(cols: unknown) => Promise<{ id: string }[]>>()
    .mockResolvedValue([{ id: 'session-1' }]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  return { select, insert, insertValues, update, updateSet, updateWhere, updateReturning };
}

// Resolución de grupo (Fase 4): mockeada acá, igual que el db -- la lógica
// de CallGroupResolverService tiene su propia suite
// (call-group-resolver.service.spec.ts). Default: degenera EXACTAMENTE al
// camino de hoy (un solo nombre, ancla = self, sin consultas), para que
// ningún test preexistente de este archivo necesite saber que esta pieza
// existe.
function createGroupResolverMock() {
  return {
    resolveCallGroupRoomNames: vi
      .fn<(roomId: string | null, roomCode: string) => Promise<string[]>>()
      .mockImplementation((_roomId, roomCode) => Promise.resolve([roomCode])),
    resolveGroupAnchor: vi
      .fn<(sid: string, roomCode: string) => Promise<{ parentSid: string; parentCode: string }>>()
      .mockImplementation((sid, roomCode) =>
        Promise.resolve({ parentSid: sid, parentCode: roomCode }),
      ),
    findExpiredBreakouts: vi.fn(),
  };
}

// Fase 5 (tasks.md 5.7.7): BreakoutRoomsService.closeGroupBreakouts se
// invoca desde claimAndClose, ANTES del deleteRoom de la principal. Mock
// degenerado por defecto -- no-op, así que ningún test preexistente de este
// archivo (que no ejercita la cascada en sí) necesita saber que esta pieza
// existe. Ver breakout-rooms.service.spec.ts para su propia suite.
function createBreakoutRoomsMock() {
  return {
    closeGroupBreakouts: vi
      .fn<(roomId: string | null, parentCode: string) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
}

// Jest resuelve timers falsos y promesas mockeadas en microtasks separados;
// advanceTimersByTimeAsync ya se encarga de dejarlos correr, pero una vuelta
// extra de microtask queda documentada acá por si algún entorno de CI más
// viejo no soporta la variante async de los fake timers.
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('CallSessionCloseService', () => {
  let db: ReturnType<typeof createDbMock>;
  let groupResolver: ReturnType<typeof createGroupResolverMock>;
  let breakoutRooms: ReturnType<typeof createBreakoutRoomsMock>;
  let service: CallSessionCloseService;
  let listParticipants: MockInstance<RoomServiceClient['listParticipants']>;
  let deleteRoom: MockInstance<RoomServiceClient['deleteRoom']>;

  beforeEach(() => {
    vi.useFakeTimers();
    db = createDbMock();
    groupResolver = createGroupResolverMock();
    breakoutRooms = createBreakoutRoomsMock();
    service = new CallSessionCloseService(
      new ConfigService(config),
      db as unknown as DrizzleDb,
      groupResolver as unknown as CallGroupResolverService,
      breakoutRooms as unknown as BreakoutRoomsService,
    );
    listParticipants = vi.spyOn(RoomServiceClient.prototype, 'listParticipants');
    deleteRoom = vi.spyOn(RoomServiceClient.prototype, 'deleteRoom').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('único admin se desconecta sin otro admin conectado: no cierra de inmediato, agenda un re-chequeo a T+15s (D3)', async () => {
    listParticipants.mockResolvedValue([]);

    await service.onAdminLeft('RM_session-A', 'abc-defg-hij');
    expect(deleteRoom).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(deleteRoom).toHaveBeenCalledWith('abc-defg-hij');
  });

  it('admin se reconecta (nuevo identity) dentro de la ventana: el re-chequeo a T+15s lo encuentra y cancela el cierre (spec host-gate/cierre-forzado)', async () => {
    listParticipants.mockResolvedValueOnce([]); // al momento del participant_left: nadie más conectado
    await service.onAdminLeft('RM_session-A', 'abc-defg-hij');

    // El admin se reconectó con un identity NUEVO antes de T+15s: el
    // re-chequeo ahora lo ve conectado, con su roleAtIssue ya escrito.
    listParticipants.mockResolvedValueOnce([{ identity: 'admin-reconnected' } as ParticipantInfo]);
    db.select.mockReturnValueOnce(chain([{ id: 'identity-row-new' }]));

    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(deleteRoom).not.toHaveBeenCalled();
  });

  it('dos participant_left de admins casi simultáneos agendan un único cierre (single-flight, capa 1 de D4)', async () => {
    listParticipants.mockResolvedValue([]);

    await Promise.all([
      service.onAdminLeft('RM_session-A', 'abc-defg-hij'),
      service.onAdminLeft('RM_session-A', 'abc-defg-hij'),
    ]);

    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(deleteRoom).toHaveBeenCalledTimes(1);
  });

  it('compare-and-set sin filas afectadas (otro proceso ya reclamó el cierre): no llama a deleteRoom (capa 2 de D4)', async () => {
    listParticipants.mockResolvedValue([]);
    db.updateReturning.mockResolvedValue([]);

    await service.onAdminLeft('RM_session-A', 'abc-defg-hij');
    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(deleteRoom).not.toHaveBeenCalled();
  });

  it('[BUG] crea la fila de call_sessions de forma perezosa antes del compare-and-set: sin esto el UPDATE siempre afecta 0 filas porque la fila nunca existe todavía (no es "otro proceso ya la reclamó", es que jamás se creó)', async () => {
    listParticipants.mockResolvedValue([]);

    // Modela el comportamiento real de Postgres en vez de un mock ciego: el
    // UPDATE solo puede afectar una fila si esa fila YA EXISTE (creada por un
    // INSERT previo). El camino de cierre forzado llega ANTES que
    // room_finished (es más: deleteRoom() es lo que lo provoca), así que la
    // única función que hoy crea esa fila (CallsWebhookService.onRoomFinished)
    // todavía no corrió. Sin una creación perezosa acá, rowExists nunca pasa
    // a true y el UPDATE de abajo devuelve 0 filas SIEMPRE.
    let rowExists = false;
    db.insert.mockImplementation((table: unknown) => ({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockImplementation(() => {
          if (table === callSessions) rowExists = true;
          return Promise.resolve();
        }),
      }),
    }));
    db.updateReturning.mockImplementation(() =>
      Promise.resolve(rowExists ? [{ id: 'session-1' }] : []),
    );

    await service.onAdminLeft('RM_session-A', 'abc-defg-hij');
    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(db.insert).toHaveBeenCalledWith(callSessions);
    expect(deleteRoom).toHaveBeenCalledWith('abc-defg-hij');
  });

  it('ensureSessionRow resuelve roomId desde call_participant_identities, no desde una búsqueda por rooms.code (D4-D)', async () => {
    listParticipants.mockResolvedValue([]); // sin admin conectado en ambos chequeos: fuerza el cierre
    await service.onAdminLeft('RM_session-A', 'abc-defg-hij');

    // Dentro de claimAndClose -> ensureSessionRow: primero callEvents (para
    // derivar identityKeys y startedAt), después call_participant_identities
    // (para resolver roomId). hasConnectedAdmin no llega a tocar la base
    // porque listParticipants ya devuelve [] (corta antes del select).
    db.select
      .mockReturnValueOnce(
        chain([{ occurredAt: new Date('2026-11-06T10:00:00Z'), livekitIdentity: 'id-a' }]),
      )
      .mockReturnValueOnce(chain([{ roomId: 'room-real' }]));

    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(db.insertValues).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'room-real' }));
  });

  it('idempotencia real de la capa 2: dos reclamos sobre el mismo sid solo producen un deleteRoom, nunca un error visible', async () => {
    db.updateReturning.mockResolvedValueOnce([{ id: 'session-1' }]).mockResolvedValueOnce([]);

    // Acceso directo a la capa de persistencia (capa 2) para probar la
    // garantía real independientemente de cualquier ventana de carrera del
    // timer en memoria (capa 1, que el propio design.md reconoce como un
    // filtro del 99%, no la garantía completa).
    const close = service as unknown as {
      claimAndClose(sid: string, code: string): Promise<void>;
    };
    await expect(
      Promise.all([
        close.claimAndClose('RM_session-A', 'abc-defg-hij'),
        close.claimAndClose('RM_session-A', 'abc-defg-hij'),
      ]),
    ).resolves.toBeDefined();

    expect(deleteRoom).toHaveBeenCalledTimes(1);
  });

  it('deleteRoom falla (sala ya cerrada): no relanza, se registra con logger.log y no con logger.error (D4 capa 3)', async () => {
    listParticipants.mockResolvedValue([]);
    deleteRoom.mockRejectedValue(new Error('room not found: secret-internal-detail'));
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(service.onAdminLeft('RM_session-A', 'abc-defg-hij')).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('La sala de medios ya estaba cerrada');
  });

  it('cancelPending (invocado desde room_finished) evita el cierre si llega antes de T+15s', async () => {
    listParticipants.mockResolvedValue([]);

    await service.onAdminLeft('RM_session-A', 'abc-defg-hij');
    service.cancelPending('RM_session-A');

    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(deleteRoom).not.toHaveBeenCalled();
  });

  it('cancelPending sobre un sid sin cierre agendado no falla (no-op seguro)', () => {
    expect(() => service.cancelPending('sid-sin-timer')).not.toThrow();
  });

  it('si no se puede verificar la presencia de un admin (LiveKit no responde), no se fuerza el cierre', async () => {
    listParticipants.mockRejectedValue(new Error('livekit unreachable'));

    await service.onAdminLeft('RM_session-A', 'abc-defg-hij');
    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(deleteRoom).not.toHaveBeenCalled();
  });

  // Caracterización (Fase 3, design.md "Tests de caracterización obligatorios"):
  // fija el comportamiento ACTUAL de hasConnectedAdmin/onAdminLeft/claimAndClose
  // antes de generalizarlos a grupo en la Fase 4. Ningún assert de arriba se
  // tocó para agregar estos.

  it('[C4] hasConnectedAdmin hoy NO filtra por roomId: solo por identity + rol actual de administrador (fija el alcance antes del filtro de grupo de la Fase 4)', async () => {
    listParticipants.mockResolvedValue([{ identity: 'admin-sub' } as ParticipantInfo]);
    const whereSpy = vi.fn().mockReturnValue(chain([{ id: 'identity-row-1' }]));
    db.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({ where: whereSpy }),
      }),
    });

    const target = service as unknown as {
      hasConnectedAdmin(roomCode: string): Promise<boolean>;
    };
    const result = await target.hasConnectedAdmin('abc-defg-hij');

    expect(result).toBe(true);
    expect(whereSpy).toHaveBeenCalledWith(
      and(
        inArray(callParticipantIdentities.livekitIdentity, ['admin-sub']),
        eq(roomMembers.role, 'administrador'),
      ),
    );
  });

  describe('[C5] las tres ramas de hasConnectedAdmin', () => {
    let target: { hasConnectedAdmin(roomCode: string): Promise<boolean> };

    beforeEach(() => {
      target = service as unknown as { hasConnectedAdmin(roomCode: string): Promise<boolean> };
    });

    it('lista vacía de participantes -> false, sin consultar la base', async () => {
      listParticipants.mockResolvedValue([]);

      await expect(target.hasConnectedAdmin('abc-defg-hij')).resolves.toBe(false);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('admin presente entre los conectados -> true', async () => {
      listParticipants.mockResolvedValue([{ identity: 'admin-sub' } as ParticipantInfo]);
      db.select.mockReturnValueOnce(chain([{ id: 'identity-row-1' }]));

      await expect(target.hasConnectedAdmin('abc-defg-hij')).resolves.toBe(true);
    });

    it('listParticipants tira -> true (fail-safe: no se fuerza el cierre sin poder verificar)', async () => {
      listParticipants.mockRejectedValue(new Error('livekit unreachable'));

      await expect(target.hasConnectedAdmin('abc-defg-hij')).resolves.toBe(true);
    });
  });

  it('[C6] onAdminLeft usa el roomCode recibido tal cual, sin normalizar ni derivar ningún otro valor', async () => {
    listParticipants.mockResolvedValue([]);
    const roomCode = 'abc-defg-hij';

    await service.onAdminLeft('RM_session-A', roomCode);
    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    // listParticipants (dentro de hasConnectedAdmin) y deleteRoom (dentro de
    // claimAndClose) reciben el MISMO string que entró por parámetro: ningún
    // parseo, split ni resolución de ancla ocurre todavía en este punto.
    expect(listParticipants).toHaveBeenCalledWith(roomCode);
    expect(deleteRoom).toHaveBeenCalledWith(roomCode);
  });

  it('[C7] claimAndClose llama a deleteRoom con un solo nombre, y reclama sobre el livekit_room_sid recibido como parámetro', async () => {
    listParticipants.mockResolvedValue([]);
    const sid = 'RM_session-A';
    const roomCode = 'abc-defg-hij';

    await service.onAdminLeft(sid, roomCode);
    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(deleteRoom).toHaveBeenCalledTimes(1);
    expect(deleteRoom).toHaveBeenCalledWith(roomCode);
    expect(db.updateWhere).toHaveBeenCalledWith(
      and(eq(callSessions.livekitRoomSid, sid), isNull(callSessions.forcedCloseAt)),
    );
  });

  // Fase 4 (design.md D3/D4/D7): generalización a grupo de
  // hasConnectedAdmin/onAdminLeft/claimAndClose. Ningún assert de arriba
  // (incluidos C4-C7) se tocó para agregar lo de abajo.

  it('[4.4.1] con más de un nombre en el grupo, hasConnectedAdmin también filtra por roomId (D7) sin romper C4', async () => {
    const names = ['abc-defg-hij', 'abc-defg-hij::breakout-1'];
    groupResolver.resolveCallGroupRoomNames.mockResolvedValueOnce(names);
    const listRooms = vi
      .spyOn(RoomServiceClient.prototype, 'listRooms')
      .mockResolvedValue(
        names.map((name) => ({ name })) as Awaited<ReturnType<RoomServiceClient['listRooms']>>,
      );
    listParticipants.mockImplementation((name: string) =>
      Promise.resolve(
        name === names[0]
          ? ([{ identity: 'guest-x' } as ParticipantInfo] as Awaited<
              ReturnType<RoomServiceClient['listParticipants']>
            >)
          : ([{ identity: 'admin-sub' } as ParticipantInfo] as Awaited<
              ReturnType<RoomServiceClient['listParticipants']>
            >),
      ),
    );
    const whereSpy = vi.fn().mockReturnValue(chain([{ id: 'identity-row-1' }]));
    db.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({ where: whereSpy }),
      }),
    });

    const target = service as unknown as {
      hasConnectedAdmin(roomCode: string, roomId: string | null): Promise<boolean>;
    };
    const result = await target.hasConnectedAdmin('abc-defg-hij', 'room-1');

    expect(result).toBe(true);
    expect(listRooms).toHaveBeenCalledWith(names);
    expect(whereSpy).toHaveBeenCalledWith(
      and(
        inArray(callParticipantIdentities.livekitIdentity, ['guest-x', 'admin-sub']),
        eq(roomMembers.role, 'administrador'),
        eq(callParticipantIdentities.roomId, 'room-1'),
      ),
    );
  });

  it('[4.4.3] onAdminLeft gana el parámetro roomId y lo pasa a resolveCallGroupRoomNames; con un roomCode sin "::" resolveGroupAnchor no agrega ninguna consulta', async () => {
    listParticipants.mockResolvedValue([]);

    await service.onAdminLeft('RM_session-A', 'abc-defg-hij', 'room-1');

    expect(groupResolver.resolveGroupAnchor).toHaveBeenCalledWith('RM_session-A', 'abc-defg-hij');
    expect(groupResolver.resolveCallGroupRoomNames).toHaveBeenCalledWith('room-1', 'abc-defg-hij');
  });

  it('[4.4.4] pendingCloses se indexa por el sid del PADRE (parentSid): dos admins de dos salas distintas del mismo grupo producen un solo timer', async () => {
    listParticipants.mockResolvedValue([]);
    groupResolver.resolveGroupAnchor.mockImplementation(() =>
      Promise.resolve({ parentSid: 'RM_parent', parentCode: 'abc-defg-hij' }),
    );

    await Promise.all([
      service.onAdminLeft('RM_breakout-1', 'abc-defg-hij::breakout-1', 'room-1'),
      service.onAdminLeft('RM_breakout-2', 'abc-defg-hij::breakout-2', 'room-1'),
    ]);

    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(deleteRoom).toHaveBeenCalledTimes(1);
    expect(deleteRoom).toHaveBeenCalledWith('abc-defg-hij');
  });

  it('[4.4.6] claimAndClose(parentSid, parentCode, roomId) con grupo de un solo nombre sigue llamando a deleteRoom una sola vez (C7 no se rompe)', async () => {
    const close = service as unknown as {
      claimAndClose(sid: string, code: string, roomId: string | null): Promise<void>;
    };

    await close.claimAndClose('RM_session-A', 'abc-defg-hij', 'room-1');

    expect(deleteRoom).toHaveBeenCalledTimes(1);
    expect(deleteRoom).toHaveBeenCalledWith('abc-defg-hij');
  });

  // Fase 5 (tasks.md 5.7.7, design.md Flujo 3): wiring diferido de la Fase 4
  // -- claimAndClose invoca closeGroupBreakouts ANTES del deleteRoom de la
  // principal. Aditivo: ningún assert de arriba se tocó.

  it('[5.7.7] claimAndClose invoca closeGroupBreakouts(roomId, parentCode) antes de deleteRoom de la principal', async () => {
    const callOrder: string[] = [];
    breakoutRooms.closeGroupBreakouts.mockImplementation(() => {
      callOrder.push('closeGroupBreakouts');
      return Promise.resolve(undefined);
    });
    deleteRoom.mockImplementation(() => {
      callOrder.push('deleteRoom');
      return Promise.resolve(undefined);
    });
    listParticipants.mockResolvedValue([]);

    await service.onAdminLeft('RM_session-A', 'abc-defg-hij', 'room-1');
    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(breakoutRooms.closeGroupBreakouts).toHaveBeenCalledWith('room-1', 'abc-defg-hij');
    expect(callOrder).toEqual(['closeGroupBreakouts', 'deleteRoom']);
  });

  it('[5.7.7] con roomId null, closeGroupBreakouts se invoca igual (no-op tolerante, D-sin-correlación)', async () => {
    listParticipants.mockResolvedValue([]);

    await service.onAdminLeft('RM_session-A', 'abc-defg-hij');
    await vi.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(breakoutRooms.closeGroupBreakouts).toHaveBeenCalledWith(null, 'abc-defg-hij');
    expect(deleteRoom).toHaveBeenCalledWith('abc-defg-hij');
  });

  // R1 (design.md "R1 -- Admin sola que se traslada", tasks.md Fase 1):
  // caracterización del comportamiento ACTUAL de hasConnectedAdmin/
  // onAdminLeft/recheckAndClose con grupo multi-sala (R1-C1, R1-C2, red de
  // seguridad antes de tocar el evaluador), seguida de la mitigación nueva
  // hasAdminAssignmentInFlight (R1-C3, R1-C4). Ningún assert de arriba se
  // tocó para agregar lo de abajo.
  describe('R1 -- admin sola que se traslada a una mini sala', () => {
    const roomCode = 'abc-defg-hij';
    const breakoutName = `${roomCode}::breakout-1`;
    const roomId = 'room-1';

    beforeEach(() => {
      groupResolver.resolveCallGroupRoomNames.mockResolvedValue([roomCode, breakoutName]);
    });

    it('[R1-C1] con la mini sala creada y vacía y la principal vacía, onAdminLeft agenda el timer (comportamiento de hoy, antes de la mitigación)', async () => {
      vi.spyOn(RoomServiceClient.prototype, 'listRooms').mockResolvedValue(
        [roomCode, breakoutName].map((name) => ({ name })) as Awaited<
          ReturnType<RoomServiceClient['listRooms']>
        >,
      );
      listParticipants.mockResolvedValue([]); // ambas salas vacías

      await service.onAdminLeft('RM_session-A', roomCode, roomId);

      // El timer todavía no corrió: ningún cierre inmediato.
      expect(deleteRoom).not.toHaveBeenCalled();
    });

    it('[R1-C2] a T+15s con la identity nueva presente en la mini sala, recheckAndClose no llama a deleteRoom', async () => {
      vi.spyOn(RoomServiceClient.prototype, 'listRooms').mockResolvedValue(
        [roomCode, breakoutName].map((name) => ({ name })) as Awaited<
          ReturnType<RoomServiceClient['listRooms']>
        >,
      );
      // Al momento del participant_left: ambas salas vacías todavía.
      listParticipants.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await service.onAdminLeft('RM_session-A', roomCode, roomId);

      // La reconexión completó antes de T+15s: la identity nueva ya está
      // en la mini sala, y su roleAtIssue ya quedó escrito (heredado por
      // moveIn).
      listParticipants
        .mockResolvedValueOnce([]) // principal
        .mockResolvedValueOnce([{ identity: 'admin-reconnected-new' } as ParticipantInfo]); // mini sala
      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(chain([{ id: 'identity-row-new' }])),
        }),
      });

      await vi.advanceTimersByTimeAsync(15_000);
      await flushMicrotasks();

      expect(deleteRoom).not.toHaveBeenCalled();
    });

    it('[R1-C3] asignación de admin de 5s de antigüedad suprime el cierre; de 60s de antigüedad, no', async () => {
      vi.spyOn(RoomServiceClient.prototype, 'listRooms').mockResolvedValue(
        [roomCode, breakoutName].map((name) => ({ name })) as Awaited<
          ReturnType<RoomServiceClient['listRooms']>
        >,
      );
      listParticipants.mockResolvedValue([]); // ambas salas vacías, siempre

      // Rama "fresca" (5s): hasAdminAssignmentInFlight encuentra una fila.
      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue(chain([{ id: 'occupant-fresh' }])),
            }),
          }),
        }),
      });
      await service.onAdminLeft('RM_session-A', roomCode, roomId);
      await vi.advanceTimersByTimeAsync(15_000);
      await flushMicrotasks();
      expect(deleteRoom).not.toHaveBeenCalled();

      // Rama "vencida" (60s, simulada: ninguna fila -- el cutoff real de
      // 30s en producción ya la habría excluido): hasAdminAssignmentInFlight
      // no encuentra nada (el default del mock ya es sin fila) -> el
      // cierre procede.
      await service.onAdminLeft('RM_session-A', roomCode, roomId);
      await vi.advanceTimersByTimeAsync(15_000);
      await flushMicrotasks();
      expect(deleteRoom).toHaveBeenCalledWith(roomCode);
    });

    it('[R1-C3] hasAdminAssignmentInFlight consulta el join de tres tablas filtrando por roomId, mini sala abierta, asignación abierta y roleAtIssue=administrador', async () => {
      vi.spyOn(RoomServiceClient.prototype, 'listRooms').mockResolvedValue(
        [roomCode, breakoutName].map((name) => ({ name })) as Awaited<
          ReturnType<RoomServiceClient['listRooms']>
        >,
      );
      listParticipants.mockResolvedValue([]);

      const whereSpy = vi.fn().mockReturnValue(chain([] as { id: string }[]));
      const innerJoin2 = vi.fn().mockReturnValue({ where: whereSpy });
      const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
      const fromSpy = vi.fn().mockReturnValue({ innerJoin: innerJoin1 });
      db.select.mockReturnValueOnce({ from: fromSpy });

      await service.onAdminLeft('RM_session-A', roomCode, roomId);

      expect(fromSpy).toHaveBeenCalledWith(callBreakoutOccupants);
      expect(innerJoin1).toHaveBeenCalledWith(
        callBreakoutRooms,
        eq(callBreakoutOccupants.breakoutRoomId, callBreakoutRooms.id),
      );
      expect(innerJoin2).toHaveBeenCalledWith(
        callParticipantIdentities,
        eq(callBreakoutOccupants.livekitIdentity, callParticipantIdentities.livekitIdentity),
      );
      expect(whereSpy).toHaveBeenCalledWith(
        and(
          eq(callBreakoutRooms.roomId, roomId),
          isNull(callBreakoutRooms.closedAt),
          isNull(callBreakoutOccupants.returnedAt),
          gt(callBreakoutOccupants.assignedAt, expect.any(Date) as unknown as Date),
          eq(callParticipantIdentities.roleAtIssue, 'administrador'),
        ),
      );
    });

    it('[R1-C4] asignación fresca de un NO-admin no suprime el cierre: se agenda igual', async () => {
      vi.spyOn(RoomServiceClient.prototype, 'listRooms').mockResolvedValue(
        [roomCode, breakoutName].map((name) => ({ name })) as Awaited<
          ReturnType<RoomServiceClient['listRooms']>
        >,
      );
      listParticipants.mockResolvedValue([]);
      // hasAdminAssignmentInFlight filtra por roleAtIssue='administrador'
      // en el propio WHERE: una asignación de un no-admin nunca aparece en
      // el resultado (el mock por defecto ya es sin fila), así que el
      // cierre procede igual que si no hubiera ninguna asignación.

      await service.onAdminLeft('RM_session-A', roomCode, roomId);
      await vi.advanceTimersByTimeAsync(15_000);
      await flushMicrotasks();

      expect(deleteRoom).toHaveBeenCalledWith(roomCode);
    });
  });
});
