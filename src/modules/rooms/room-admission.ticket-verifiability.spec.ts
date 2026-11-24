import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { DrizzleDb } from '../../db/drizzle.module';
import type { Room } from '../../db/schema';
import { RoomAccessService } from '../auth/room-access.service';
import { chain, createFakeDb, type FakeDb } from '../../test-support/fake-drizzle';
import { RoomAdmissionService } from './room-admission.service';
import type { RoomResolverService } from './room-resolver.service';

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    code: 'abc-defg-hij',
    name: 'Sala permanente',
    isActive: true,
    isPermanent: true,
    historyDeletedBefore: null,
    historyCleanupPending: false,
    lastEnteredAt: new Date(),
    retiredAt: null,
    waitingRoomEnabled: true,
    entryLocked: false,
    createdAt: new Date(),
    chimeMeetingId: null,
    ...overrides,
  };
}

// Task 6.3 (design.md D7, lines 522-531 and "Testing notes" line 734). The
// regression this guards against: dropping the DB TTL alone does NOT fix
// permanent-room admission. At hour 24 the ticket JWT itself would expire
// under the old flat 24h lifetime, the student's poll would get a 401, and
// the client maps that to "expired" -- even though the DB row is still
// `pending`. Asserting only the DB row (as 3.7's test does) would have
// passed under that old assumption; this test fails unless BOTH halves
// hold, using a REAL JwtService (not mocked) so the ticket's actual
// expiresIn is what's under test.
//
// Advances the clock via a Date.now() spy, NOT vi.useFakeTimers(): the
// 'jsonwebtoken' library signs/verifies through Node's crypto bindings,
// whose completion callback is scheduled on a real timer phase -- modern
// fake timers intercept that phase and the call never resolves. A plain
// Date.now() spy changes what `exp`/`iat` resolve to without touching the
// event loop at all.
describe('Permanent-room admission ticket survives past hour 24 (real JWT, fake DB)', () => {
  let db: FakeDb;
  let access: RoomAccessService;
  let resolver: {
    lockJoinable: ReturnType<typeof vi.fn>;
    touchEntry: ReturnType<typeof vi.fn>;
  };
  let service: RoomAdmissionService;
  let tx: { select: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    db = createFakeDb();
    access = new RoomAccessService(
      new JwtService(),
      new ConfigService({ JWT_ACCESS_SECRET: 'ticket-verifiability-test-secret' }),
    );
    resolver = {
      lockJoinable: vi.fn(),
      touchEntry: vi.fn().mockResolvedValue(undefined),
    };
    service = new RoomAdmissionService(
      db as unknown as DrizzleDb,
      access,
      resolver as unknown as RoomResolverService,
    );
    tx = {
      select: vi.fn().mockReturnValue(chain([])),
      insert: vi.fn().mockReturnValue(chain([])),
    };
    db.transaction.mockImplementation(async (cb: unknown) =>
      (cb as (t: typeof tx) => Promise<unknown>)(tx),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('at hour 25: the ticket still verifies AND the request row is still pending', async () => {
    const room = makeRoom();
    resolver.lockJoinable.mockResolvedValueOnce(room);
    // Sin authorization header: authenticateAccount no busca userId, así
    // que request() nunca llama a tx.select -- no hace falta mockearlo.

    const pending = await service.request(room.code, 'Ana');
    if (!('ticket' in pending)) throw new Error('expected a pending receipt with a ticket');
    const { requestId, ticket } = pending;

    const hour25 = Date.now() + 25 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(hour25);

    // Half 1: the ticket itself, signed `expiresIn: '365d'` for a
    // permanent room (room-access.service.ts), still verifies at hour 25 --
    // it would NOT under the old flat 24h lifetime.
    await expect(access.verifyAdmissionTicket(ticket, room.id, requestId)).resolves.toBeUndefined();

    // Half 2: the DB row itself is still `pending` (expiresAt NULL, D7).
    resolver.lockJoinable.mockResolvedValueOnce(room);
    tx.select.mockReturnValueOnce(
      chain([
        {
          id: requestId,
          roomId: room.id,
          status: 'pending',
          expiresAt: null,
          name: 'Ana',
          userId: null,
          createdAt: new Date(),
        },
      ]),
    );

    await expect(service.status(room.code, requestId, ticket)).resolves.toEqual({
      status: 'pending',
      blocked: false,
    });
  });

  it("[regression guard] a NON-permanent room's 24h ticket is correctly rejected by hour 25 -- proves the spy actually moves the clock", async () => {
    const room = makeRoom({ isPermanent: false });
    resolver.lockJoinable.mockResolvedValueOnce(room);

    const pending = await service.request(room.code, 'Ana');
    if (!('ticket' in pending)) throw new Error('expected a pending receipt with a ticket');
    const { requestId, ticket } = pending;

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);

    await expect(access.verifyAdmissionTicket(ticket, room.id, requestId)).rejects.toThrow();
  });
});
