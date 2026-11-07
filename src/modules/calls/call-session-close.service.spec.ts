import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoomServiceClient, type ParticipantInfo } from 'livekit-server-sdk';
import type { DrizzleDb } from '../../db/drizzle.module';
import { callEvents, callSessions, rooms } from '../../db/schema';
import { chain } from '../../test-support/fake-drizzle';
import { CallSessionCloseService } from './call-session-close.service';

const config = {
  LIVEKIT_URL: 'wss://media.example.com',
  LIVEKIT_API_URL: 'http://localhost:7880',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: 'test-secret-at-least-32-characters-long',
};

function createDbMock() {
  // select(...).from(table).where(...).limit(1) — enrutado por tabla, mismo
  // patrón que calls-webhook.service.spec.ts. Tres usos posibles: (a)
  // callParticipantIdentities en hasConnectedAdmin() — default sin fila (sin
  // admin conectado); (b) callEvents en ensureSessionRow() — default sin
  // eventos (startedAt cae al fallback new Date()); (c) rooms en
  // ensureSessionRow() — default sin sala (roomId queda null).
  const select = jest.fn().mockImplementation(() => ({
    from: jest.fn().mockImplementation((table: unknown) => {
      if (table === callEvents) return chain([] as { occurredAt: Date }[]);
      if (table === rooms) return chain([] as { id: string }[]);
      return chain([] as { id: string }[]); // callParticipantIdentities
    }),
  }));

  // insert(callSessions).values(...).onConflictDoNothing() — creación
  // perezosa de la cabecera de sesión (ver claimAndClose/ensureSessionRow).
  // Default: no-op exitoso, sin modelar si la fila ya existía o no.
  const insertValues = jest.fn().mockReturnValue({
    onConflictDoNothing: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
  const insert = jest.fn().mockReturnValue({ values: insertValues });

  // update(callSessions).set(...).where(...).returning(...) — claimAndClose().
  // Default: compare-and-set gana (1 fila devuelta).
  const updateReturning = jest
    .fn<(cols: unknown) => Promise<{ id: string }[]>>()
    .mockResolvedValue([{ id: 'session-1' }]);
  const updateWhere = jest.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set: updateSet });

  return { select, insert, insertValues, update, updateSet, updateWhere, updateReturning };
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
  let service: CallSessionCloseService;
  let listParticipants: jest.SpiedFunction<RoomServiceClient['listParticipants']>;
  let deleteRoom: jest.SpiedFunction<RoomServiceClient['deleteRoom']>;

  beforeEach(() => {
    jest.useFakeTimers();
    db = createDbMock();
    service = new CallSessionCloseService(new ConfigService(config), db as unknown as DrizzleDb);
    listParticipants = jest.spyOn(RoomServiceClient.prototype, 'listParticipants');
    deleteRoom = jest.spyOn(RoomServiceClient.prototype, 'deleteRoom').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('único admin se desconecta sin otro admin conectado: no cierra de inmediato, agenda un re-chequeo a T+15s (D3)', async () => {
    listParticipants.mockResolvedValue([]);

    await service.onAdminLeft('RM_session-A', 'abc-defg-hij');
    expect(deleteRoom).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(15_000);
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

    await jest.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(deleteRoom).not.toHaveBeenCalled();
  });

  it('dos participant_left de admins casi simultáneos agendan un único cierre (single-flight, capa 1 de D4)', async () => {
    listParticipants.mockResolvedValue([]);

    await Promise.all([
      service.onAdminLeft('RM_session-A', 'abc-defg-hij'),
      service.onAdminLeft('RM_session-A', 'abc-defg-hij'),
    ]);

    await jest.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(deleteRoom).toHaveBeenCalledTimes(1);
  });

  it('compare-and-set sin filas afectadas (otro proceso ya reclamó el cierre): no llama a deleteRoom (capa 2 de D4)', async () => {
    listParticipants.mockResolvedValue([]);
    db.updateReturning.mockResolvedValue([]);

    await service.onAdminLeft('RM_session-A', 'abc-defg-hij');
    await jest.advanceTimersByTimeAsync(15_000);
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
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockImplementation(() => {
          if (table === callSessions) rowExists = true;
          return Promise.resolve();
        }),
      }),
    }));
    db.updateReturning.mockImplementation(() =>
      Promise.resolve(rowExists ? [{ id: 'session-1' }] : []),
    );

    await service.onAdminLeft('RM_session-A', 'abc-defg-hij');
    await jest.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(db.insert).toHaveBeenCalledWith(callSessions);
    expect(deleteRoom).toHaveBeenCalledWith('abc-defg-hij');
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
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(service.onAdminLeft('RM_session-A', 'abc-defg-hij')).resolves.toBeUndefined();
    await jest.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('La sala de medios ya estaba cerrada');
  });

  it('cancelPending (invocado desde room_finished) evita el cierre si llega antes de T+15s', async () => {
    listParticipants.mockResolvedValue([]);

    await service.onAdminLeft('RM_session-A', 'abc-defg-hij');
    service.cancelPending('RM_session-A');

    await jest.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(deleteRoom).not.toHaveBeenCalled();
  });

  it('cancelPending sobre un sid sin cierre agendado no falla (no-op seguro)', () => {
    expect(() => service.cancelPending('sid-sin-timer')).not.toThrow();
  });

  it('si no se puede verificar la presencia de un admin (LiveKit no responde), no se fuerza el cierre', async () => {
    listParticipants.mockRejectedValue(new Error('livekit unreachable'));

    await service.onAdminLeft('RM_session-A', 'abc-defg-hij');
    await jest.advanceTimersByTimeAsync(15_000);
    await flushMicrotasks();

    expect(deleteRoom).not.toHaveBeenCalled();
  });
});
