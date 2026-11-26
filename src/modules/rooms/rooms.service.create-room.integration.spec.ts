import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { rooms, roomScheduleSlots, users, type NewUser } from '../../db/schema';
import { connectTestDb } from '../../test-support/test-database';
import { RoomEventsService } from './room-events.service';
import { RoomResolverService } from './room-resolver.service';

// ESM named exports are live, read-only bindings -- vi.spyOn cannot patch
// generateRoomCode in place ("Cannot assign to read only property").
// vi.mock + a dynamic import of the module under test is the supported way
// to control it for these real-Postgres collision tests (4.11, 6.1).
// vi.hoisted keeps the mock reachable both from the vi.mock factory (which
// is hoisted above all imports) and from beforeEach/the test bodies below.
const generateRoomCodeMock = vi.hoisted(() => vi.fn<() => string>());
vi.mock('../../common/generate-room-code', () => ({
  generateRoomCode: generateRoomCodeMock,
}));
const { RoomsService } = await import('./rooms.service');

// Tasks 4.11/4.12: real Postgres, not mocks -- the sweep-then-probe
// ordering and the all-or-nothing slot insert are transaction-level
// guarantees that a mocked `db.transaction` callback cannot actually prove
// (it never really rolls anything back).
describe('RoomsService.createRoom — transaction integration (real Postgres)', () => {
  let ctx: ReturnType<typeof connectTestDb>;
  const insertedRoomIds: string[] = [];
  const insertedUserIds: string[] = [];

  beforeAll(() => {
    ctx = connectTestDb();
  });

  beforeEach(() => {
    generateRoomCodeMock.mockReset();
  });

  afterEach(async () => {
    while (insertedRoomIds.length > 0) {
      await ctx.db.delete(rooms).where(eq(rooms.id, insertedRoomIds.pop()!));
    }
    while (insertedUserIds.length > 0) {
      await ctx.db.delete(users).where(eq(users.id, insertedUserIds.pop()!));
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function insertUser(): Promise<string> {
    const email = `${randomUUID()}@test.date2gether`;
    const [user] = await ctx.db
      .insert(users)
      .values({ email, passwordHash: 'x', name: 'Owner' } as NewUser)
      .returning();
    insertedUserIds.push(user.id);
    return user.id;
  }

  it('[4.11] retires an eligible room BEFORE probing the pool, freeing its code for the same creation', async () => {
    const resolver = new RoomResolverService(ctx.db);
    const service = new RoomsService(ctx.db, new RoomEventsService(), resolver);
    const ownerId = await insertUser();
    const fixedCode = `fx-${randomUUID().slice(0, 8)}`;

    // R1 occupies fixedCode and is idle well past the 24h window, with no
    // open call session — eligible for the allocation-time sweep.
    const [r1] = await ctx.db
      .insert(rooms)
      .values({
        code: fixedCode,
        name: 'R1 (a retirar)',
        isPermanent: false,
        lastEnteredAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      })
      .returning();
    insertedRoomIds.push(r1.id);

    // Collides with R1 on the first attempt unless the sweep already
    // retired it before the probe ran.
    generateRoomCodeMock.mockReturnValueOnce(fixedCode);

    const r2 = await service.createRoom('R2', ownerId);
    insertedRoomIds.push(r2.id);

    expect(r2.code).toBe(fixedCode);
    expect(r2.id).not.toBe(r1.id);
    const [r1Reloaded] = await ctx.db.select().from(rooms).where(eq(rooms.id, r1.id));
    expect(r1Reloaded.retiredAt).not.toBeNull();
  });

  it('[4.11] a failing slot insert rolls back the whole room creation (room, member and slots all-or-nothing)', async () => {
    const resolver = new RoomResolverService(ctx.db);
    const service = new RoomsService(ctx.db, new RoomEventsService(), resolver);
    const ownerId = await insertUser();
    const code = `at-${randomUUID().slice(0, 8)}`;
    generateRoomCodeMock.mockReturnValue(code);

    // An invalid dayOfWeek violates the DB CHECK constraint
    // (room_schedule_slots_day_of_week_valid) — the whole transaction,
    // including the room and member rows already inserted earlier in the
    // SAME transaction, must roll back with it.
    await expect(
      service.createRoom('Sala con slot inválido', ownerId, {
        slots: [{ dayOfWeek: 9, timeOfDay: '07:00', timezone: 'UTC' }],
      }),
    ).rejects.toThrow();

    const [orphanRoom] = await ctx.db.select().from(rooms).where(eq(rooms.code, code));
    expect(orphanRoom).toBeUndefined();
  });

  it('[4.12] confirms 4.11: slots created alongside a room persist atomically on the happy path', async () => {
    const resolver = new RoomResolverService(ctx.db);
    const service = new RoomsService(ctx.db, new RoomEventsService(), resolver);
    const ownerId = await insertUser();
    const code = `ok-${randomUUID().slice(0, 8)}`;
    generateRoomCodeMock.mockReturnValue(code);

    const room = await service.createRoom('Sala con horario', ownerId, {
      slots: [{ dayOfWeek: 2, timeOfDay: '07:00', timezone: 'UTC' }],
    });
    insertedRoomIds.push(room.id);

    const slots = await ctx.db
      .select()
      .from(roomScheduleSlots)
      .where(eq(roomScheduleSlots.roomId, room.id));
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ dayOfWeek: 2, timeOfDay: '07:00', timezone: 'UTC' });
  });
});
