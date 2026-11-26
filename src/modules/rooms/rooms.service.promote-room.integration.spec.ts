import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { roomMembers, rooms, users, type NewUser } from '../../db/schema';
import { connectTestDb } from '../../test-support/test-database';
import { RoomEventsService } from './room-events.service';
import { RoomResolverService } from './room-resolver.service';
import { RoomsService } from './rooms.service';

describe('RoomsService.promoteToPermanent (real Postgres)', () => {
  let ctx: ReturnType<typeof connectTestDb>;
  const roomIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(() => {
    ctx = connectTestDb();
  });

  afterEach(async () => {
    while (roomIds.length > 0) await ctx.db.delete(rooms).where(eq(rooms.id, roomIds.pop()!));
    while (userIds.length > 0) await ctx.db.delete(users).where(eq(users.id, userIds.pop()!));
  });

  afterAll(async () => {
    await ctx.close();
  });

  const service = () =>
    new RoomsService(ctx.db, new RoomEventsService(), new RoomResolverService(ctx.db));

  async function seed(role: 'administrador' | 'participante', opts: { stale?: boolean } = {}) {
    const [user] = await ctx.db
      .insert(users)
      .values({
        email: `${randomUUID()}@test.date2gether`,
        passwordHash: 'x',
        name: 'Ana',
      } as NewUser)
      .returning();
    userIds.push(user.id);
    const [room] = await ctx.db
      .insert(rooms)
      .values({
        code: `pr-${randomUUID().slice(0, 8)}`,
        name: 'Temporal',
        ...(opts.stale ? { lastEnteredAt: sql`now() - interval '25 hours'` as never } : {}),
      })
      .returning();
    roomIds.push(room.id);
    await ctx.db.insert(roomMembers).values({ roomId: room.id, userId: user.id, role });
    return { user, room };
  }

  it('promueve una sala viva: permanente, sala de espera forzada y código conservado', async () => {
    const { user, room } = await seed('administrador');

    const promoted = await service().promoteToPermanent(room.code, user.id);

    expect(promoted).toMatchObject({
      isPermanent: true,
      waitingRoomEnabled: true,
      retiredAt: null,
    });
    const [row] = await ctx.db.select().from(rooms).where(eq(rooms.id, room.id));
    expect(row.isPermanent).toBe(true);
    expect(row.waitingRoomEnabled).toBe(true);
  });

  it('es idempotente', async () => {
    const { user, room } = await seed('administrador');
    await service().promoteToPermanent(room.code, user.id);

    await expect(service().promoteToPermanent(room.code, user.id)).resolves.toMatchObject({
      isPermanent: true,
    });
  });

  it('responde 403 a un no administrador y no modifica la sala', async () => {
    const { user, room } = await seed('participante');

    await expect(service().promoteToPermanent(room.code, user.id)).rejects.toThrow(
      ForbiddenException,
    );
    const [row] = await ctx.db.select().from(rooms).where(eq(rooms.id, room.id));
    expect(row.isPermanent).toBe(false);
  });

  it('responde 404 si la sala venció aunque todavía no esté retirada (barrido perezoso)', async () => {
    const { user, room } = await seed('administrador', { stale: true });

    await expect(service().promoteToPermanent(room.code, user.id)).rejects.toThrow(
      NotFoundException,
    );
    const [row] = await ctx.db.select().from(rooms).where(eq(rooms.id, room.id));
    expect(row.isPermanent).toBe(false);
  });
});
