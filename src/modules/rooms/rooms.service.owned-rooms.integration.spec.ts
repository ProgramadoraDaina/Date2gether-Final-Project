import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { roomMembers, rooms, roomScheduleSlots, users, type NewUser } from '../../db/schema';
import { connectTestDb } from '../../test-support/test-database';
import { RoomEventsService } from './room-events.service';
import { RoomResolverService } from './room-resolver.service';
import { RoomsService } from './rooms.service';

describe('RoomsService.listOwnedRooms (real Postgres)', () => {
  let ctx: ReturnType<typeof connectTestDb>;
  const insertedRoomIds: string[] = [];
  const insertedUserIds: string[] = [];

  beforeAll(() => {
    ctx = connectTestDb();
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

  async function insertUser(name: string): Promise<string> {
    const [user] = await ctx.db
      .insert(users)
      .values({ email: `${randomUUID()}@test.date2gether`, passwordHash: 'x', name } as NewUser)
      .returning();
    insertedUserIds.push(user.id);
    return user.id;
  }

  async function insertRoom(values: Partial<typeof rooms.$inferInsert> & { name: string }) {
    const [room] = await ctx.db
      .insert(rooms)
      .values({ code: `ow-${randomUUID().slice(0, 8)}`, ...values })
      .returning();
    insertedRoomIds.push(room.id);
    return room;
  }

  function service() {
    return new RoomsService(ctx.db, new RoomEventsService(), new RoomResolverService(ctx.db));
  }

  it('devuelve solo las salas donde soy administrador, permanentes primero, con horarios y próximo encuentro', async () => {
    const ownerId = await insertUser('Owner');
    const otherId = await insertUser('Other');
    const now = new Date('2026-11-18T12:00:00.000Z');

    const permanent = await insertRoom({ name: 'Cita de los lunes', isPermanent: true });
    await ctx.db
      .insert(roomMembers)
      .values({ roomId: permanent.id, userId: ownerId, role: 'administrador' });
    await ctx.db.insert(roomScheduleSlots).values({
      roomId: permanent.id,
      dayOfWeek: 1,
      timeOfDay: '21:30',
      timezone: 'America/Argentina/Buenos_Aires',
    });

    const temporary = await insertRoom({ name: 'Sala rápida', lastEnteredAt: new Date() });
    await ctx.db
      .insert(roomMembers)
      .values({ roomId: temporary.id, userId: ownerId, role: 'administrador' });

    const joinedOnly = await insertRoom({ name: 'Sala ajena' });
    await ctx.db.insert(roomMembers).values([
      { roomId: joinedOnly.id, userId: otherId, role: 'administrador' },
      { roomId: joinedOnly.id, userId: ownerId, role: 'participante' },
    ]);

    const retired = await insertRoom({ name: 'Sala retirada', retiredAt: new Date() });
    await ctx.db
      .insert(roomMembers)
      .values({ roomId: retired.id, userId: ownerId, role: 'administrador' });

    const result = await service().listOwnedRooms(ownerId, now);

    expect(result.map((room) => room.name)).toEqual(['Cita de los lunes', 'Sala rápida']);
    expect(result[0]).toMatchObject({
      id: permanent.id,
      code: permanent.code,
      isPermanent: true,
      isJoinable: true,
      slots: [{ dayOfWeek: 1, timeOfDay: '21:30', timezone: 'America/Argentina/Buenos_Aires' }],
      // Monday 2026-11-23 21:30 in Buenos Aires (UTC-3).
      nextOccurrenceAt: '2026-11-24T00:30:00.000Z',
    });
    expect(result[1]).toMatchObject({
      id: temporary.id,
      isPermanent: false,
      isJoinable: true,
      slots: [],
      nextOccurrenceAt: null,
    });
  });

  it('marca como no disponible una sala temporal que pasó la ventana de 24 horas', async () => {
    const ownerId = await insertUser('Owner');
    const stale = await insertRoom({
      name: 'Sala vieja',
      lastEnteredAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    await ctx.db
      .insert(roomMembers)
      .values({ roomId: stale.id, userId: ownerId, role: 'administrador' });

    const [room] = await service().listOwnedRooms(ownerId);

    expect(room).toMatchObject({ id: stale.id, isJoinable: false });
  });

  it('devuelve una lista vacía para quien no administra ninguna sala', async () => {
    const userId = await insertUser('Nadie');

    await expect(service().listOwnedRooms(userId)).resolves.toEqual([]);
  });
});
