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
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { callHistory, rooms, users, type NewUser } from '../../db/schema';
import { connectTestDb } from '../../test-support/test-database';
import { RoomEventsService } from './room-events.service';
import { RoomResolverService } from './room-resolver.service';

// Real-Postgres mocking of generateRoomCode (ESM named exports are
// read-only, see rooms.service.create-room.integration.spec.ts). vi.hoisted
// keeps this mock reachable both from the vi.mock factory below (which is
// hoisted above all imports) and from beforeEach/the test bodies further down.
const generateRoomCodeMock = vi.hoisted(() => vi.fn<() => string>());
vi.mock('../../common/generate-room-code', () => ({
  generateRoomCode: generateRoomCodeMock,
}));
const { RoomsService } = await import('./rooms.service');
const { RoomAccessService } = await import('../auth/room-access.service');

// Task 6.1 (design.md Flow 2, lines 602-655): R1 and R2 share only the
// varchar code, never anything else. Mocked Drizzle cannot exercise this --
// the partial unique index (rooms_code_code_pool_unique) is half of the
// correctness mechanism (D3), so this runs against the real disposable
// test Postgres (`pnpm test:e2e:setup`).
describe('Room code recycling — R1 and R2 share nothing (real Postgres)', () => {
  let ctx: ReturnType<typeof connectTestDb>;
  const access = new RoomAccessService(
    new JwtService(),
    new ConfigService({ JWT_ACCESS_SECRET: 'recycling-test-secret' }),
  );
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

  it('isolates history, notes, and participant tokens between a retired room and the room that recycled its code', async () => {
    const resolver = new RoomResolverService(ctx.db);
    const service = new RoomsService(ctx.db, new RoomEventsService(), resolver);
    const fixedCode = `rc-${randomUUID().slice(0, 8)}`;

    const email = `${randomUUID()}@test.date2gether`;
    const [user] = await ctx.db
      .insert(users)
      .values({ email, passwordHash: 'x', name: 'U' } as NewUser)
      .returning();
    insertedUserIds.push(user.id);

    // R1: created, used (history + notes recorded against its id), then
    // goes idle past the 24h window.
    generateRoomCodeMock.mockReturnValueOnce(fixedCode);
    const r1 = await service.createRoom('R1', user.id);
    insertedRoomIds.push(r1.id);
    await ctx.db.insert(callHistory).values({ roomId: r1.id, userId: user.id });
    await service.saveRoomNotesById(r1.id, "R1's private notes", 0);
    await ctx.db
      .update(rooms)
      .set({ lastEnteredAt: new Date(Date.now() - 48 * 60 * 60 * 1000) })
      .where(eq(rooms.id, r1.id));

    // A participant token bound to R1's id, issued while R1 held fixedCode.
    const { token: r1Token, participant: r1Participant } = await access.create(
      r1.id,
      fixedCode,
      'Ana',
    );
    expect(await access.verify(r1Token)).toMatchObject({ roomId: r1.id });

    // R2: a brand-new room created later, recycling fixedCode (the sweep
    // inside createRoom's own transaction retires R1 first, D2/D11).
    generateRoomCodeMock.mockReturnValueOnce(fixedCode);
    const r2 = await service.createRoom('R2', user.id);
    insertedRoomIds.push(r2.id);
    expect(r2.code).toBe(fixedCode);
    expect(r2.id).not.toBe(r1.id);

    // Resolving by code now returns R2, never R1.
    const resolvedByCode = await service.getByCodeOrThrow(fixedCode);
    expect(resolvedByCode.id).toBe(r2.id);

    // R1's notes are still reachable by id (rows persist, D "Expiry removes
    // joinability, never the row") but NOT through R2's code.
    const r1NotesById = await service.getRoomNotesById(r1.id);
    expect(r1NotesById.content).toBe("R1's private notes");
    const notesByCode = await service.getRoomNotes(fixedCode);
    expect(notesByCode.content).not.toBe("R1's private notes");

    // R1's call_history row stays keyed to R1's id, invisible under R2's id.
    const [r1History] = await ctx.db
      .select()
      .from(callHistory)
      .where(eq(callHistory.roomId, r1.id));
    expect(r1History).toBeDefined();
    const r2History = await ctx.db.select().from(callHistory).where(eq(callHistory.roomId, r2.id));
    expect(r2History).toHaveLength(0);

    // Attack 1 (Flow 2): R1's old participant token presented against R2.
    resolver.assertBound(r1Participant, r1); // still valid against R1 itself
    expect(() => resolver.assertBound(r1Participant, resolvedByCode)).toThrow(ForbiddenException);
  });
});
