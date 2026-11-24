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

    const collaborated = await insertRoom({ name: 'Sala donde colaboro' });
    await ctx.db.insert(roomMembers).values([
      { roomId: collaborated.id, userId: otherId, role: 'administrador' },
      { roomId: collaborated.id, userId: ownerId, role: 'colaborador' },
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

  it('solo hereda la sala al recibir admin, conserva el rol al volver a entrar y permite el acceso sin el creador', async () => {
    const creatorId = await insertUser('Creador');
    const memberId = await insertUser('Participante');
    const room = await insertRoom({
      name: 'Sala compartida',
      isPermanent: true,
      waitingRoomEnabled: true,
      entryLocked: true,
    });
    await ctx.db.insert(roomMembers).values([
      { roomId: room.id, userId: creatorId, role: 'administrador' },
      { roomId: room.id, userId: memberId, role: 'participante' },
    ]);
    const roomsService = service();

    await roomsService.setMemberRole(room.code, memberId, 'colaborador', creatorId);
    await expect(roomsService.listOwnedRooms(memberId)).resolves.toEqual([]);

    await roomsService.setMemberRole(room.code, memberId, 'administrador', creatorId);
    await roomsService.joinRoom(room.code, memberId);

    await expect(roomsService.listOwnedRooms(memberId)).resolves.toEqual([
      expect.objectContaining({ id: room.id, code: room.code, isJoinable: true }),
    ]);
    await expect(roomsService.getMemberRole(room.code, memberId)).resolves.toBe('administrador');
    await expect(roomsService.getMemberRole(room.code, creatorId)).resolves.toBe('administrador');
  });

  it('devuelve una lista vacía para quien no administra ninguna sala', async () => {
    const userId = await insertUser('Nadie');

    await expect(service().listOwnedRooms(userId)).resolves.toEqual([]);
  });

  it.each(['participante', 'colaborador'] as const)(
    'quitar admin pasando a %s retira la sala heredada',
    async (role) => {
      const creatorId = await insertUser('Creador');
      const memberId = await insertUser('Otro admin');
      const room = await insertRoom({ name: 'Sala compartida', isPermanent: true });
      await ctx.db.insert(roomMembers).values([
        { roomId: room.id, userId: creatorId, role: 'administrador' },
        { roomId: room.id, userId: memberId, role: 'administrador' },
      ]);

      await service().setMemberRole(room.code, memberId, role, creatorId);

      await expect(service().listOwnedRooms(memberId)).resolves.toEqual([]);
      await expect(service().getMemberRole(room.code, memberId)).resolves.toBe(role);
      await expect(service().getMemberRole(room.code, creatorId)).resolves.toBe('administrador');
    },
  );

  it.each([false, true])(
    'dos peticiones concurrentes conservan un admin y verifican al solicitante (sobre sí mismo: %s)',
    async (self) => {
      const firstId = await insertUser('Primer admin');
      const secondId = await insertUser('Segundo admin');
      const room = await insertRoom({ name: 'Sala concurrente', isPermanent: true });
      await ctx.db.insert(roomMembers).values([
        { roomId: room.id, userId: firstId, role: 'administrador' },
        { roomId: room.id, userId: secondId, role: 'administrador' },
      ]);
      const otherConnection = connectTestDb();
      try {
        const otherService = new RoomsService(
          otherConnection.db,
          new RoomEventsService(),
          new RoomResolverService(otherConnection.db),
        );
        const outcomes = await Promise.allSettled([
          service().setMemberRole(room.code, self ? firstId : secondId, 'participante', firstId),
          otherService.setMemberRole(room.code, self ? secondId : firstId, 'colaborador', secondId),
        ]);
        expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const members = await service().listMembers(room.code);
        expect(members.filter((member) => member.role === 'administrador')).toHaveLength(1);
      } finally {
        await otherConnection.close();
      }
    },
  );
});
