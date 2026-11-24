import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NotFoundException } from '@nestjs/common';
import {
  callHistory,
  callParticipantIdentities,
  callSessions,
  messages,
  roomAdmissionRequests,
  roomEmojis,
  roomMembers,
  roomNotes,
  roomPlaylists,
  rooms,
  roomScheduleSlots,
  transcriptLines,
  users,
  type NewUser,
} from '../../db/schema';
import { connectTestDb } from '../../test-support/test-database';
import { RoomEventsService } from './room-events.service';
import { RoomResolverService } from './room-resolver.service';
import { RoomsService } from './rooms.service';

describe('RoomsService.deleteRoom (real Postgres)', () => {
  let ctx: ReturnType<typeof connectTestDb>;
  const insertedRoomIds: string[] = [];
  const insertedUserIds: string[] = [];
  const insertedSessionIds: string[] = [];

  beforeAll(() => {
    ctx = connectTestDb();
  });

  afterEach(async () => {
    while (insertedSessionIds.length > 0) {
      await ctx.db.delete(callSessions).where(eq(callSessions.id, insertedSessionIds.pop()!));
    }
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

  function service(events = new RoomEventsService()) {
    return new RoomsService(ctx.db, events, new RoomResolverService(ctx.db));
  }

  it('borra la sala con todo lo que cuelga de ella, sin dejar huérfanos, y conserva el historial de sesiones', async () => {
    const [user] = await ctx.db
      .insert(users)
      .values({
        email: `${randomUUID()}@test.date2gether`,
        passwordHash: 'x',
        name: 'Ana',
      } as NewUser)
      .returning();
    insertedUserIds.push(user.id);
    const [room] = await ctx.db
      .insert(rooms)
      .values({ code: `dl-${randomUUID().slice(0, 8)}`, name: 'Para borrar', isPermanent: true })
      .returning();
    insertedRoomIds.push(room.id);

    await ctx.db
      .insert(roomMembers)
      .values({ roomId: room.id, userId: user.id, role: 'administrador' });
    await ctx.db.insert(messages).values({ roomId: room.id, authorName: 'Ana', content: 'hola' });
    await ctx.db.insert(roomNotes).values({ roomId: room.id, content: 'nota' });
    await ctx.db
      .insert(roomAdmissionRequests)
      .values({ id: randomUUID(), roomId: room.id, userId: user.id, name: 'Ana' });
    await ctx.db.insert(roomScheduleSlots).values({
      roomId: room.id,
      dayOfWeek: 1,
      timeOfDay: '21:30',
      timezone: 'UTC',
    });
    await ctx.db.insert(roomPlaylists).values({ roomId: room.id });
    await ctx.db.insert(roomEmojis).values({ roomId: room.id, name: 'party', emoji: '🎉' });
    await ctx.db
      .insert(transcriptLines)
      .values({ roomId: room.id, callSid: 'RM_x', speakerName: 'Ana', content: 'hola' });
    await ctx.db.insert(callHistory).values({ roomId: room.id, userId: user.id });
    await ctx.db.insert(callParticipantIdentities).values({
      livekitIdentity: `id-${randomUUID().slice(0, 8)}`,
      roomId: room.id,
      userId: user.id,
      displayName: 'Ana',
    });
    const [session] = await ctx.db
      .insert(callSessions)
      .values({
        livekitRoomSid: `RM_${randomUUID().slice(0, 8)}`,
        roomId: room.id,
        roomCode: room.code,
        startedAt: new Date(),
      })
      .returning();
    insertedSessionIds.push(session.id);

    const events = new RoomEventsService();
    const deleted: string[] = [];
    events.onRoomDeleted(({ roomCode }) => deleted.push(roomCode));

    await service(events).deleteRoom(room.code);

    const byRoom = <T extends { roomId: unknown }>(table: T) =>
      ctx.db
        .select()
        .from(table as never)
        .where(eq((table as unknown as { roomId: never }).roomId, room.id));
    expect(await ctx.db.select().from(rooms).where(eq(rooms.id, room.id))).toHaveLength(0);
    for (const table of [
      roomMembers,
      messages,
      roomNotes,
      roomAdmissionRequests,
      roomScheduleSlots,
      roomPlaylists,
      roomEmojis,
      transcriptLines,
      callHistory,
      callParticipantIdentities,
    ]) {
      expect(await byRoom(table)).toHaveLength(0);
    }

    // La sesión de llamada sobrevive (historial), solo pierde el vínculo con la sala.
    const [survivor] = await ctx.db
      .select()
      .from(callSessions)
      .where(eq(callSessions.id, session.id));
    expect(survivor).toBeDefined();
    expect(survivor.roomId).toBeNull();
    expect(survivor.roomCode).toBe(room.code);

    // La cuenta no se toca.
    expect(await ctx.db.select().from(users).where(eq(users.id, user.id))).toHaveLength(1);
    expect(deleted).toEqual([room.code]);
  });

  it('responde 404 si el código no existe', async () => {
    await expect(service().deleteRoom('no-existe-xx')).rejects.toThrow(NotFoundException);
  });
});
