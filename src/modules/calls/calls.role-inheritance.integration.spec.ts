import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  RoomServiceClient,
  WebhookReceiver,
  type ParticipantInfo,
  type WebhookEvent,
} from 'livekit-server-sdk';
import { callEvents, callParticipantIdentities, roomMembers, rooms, users } from '../../db/schema';
import { connectTestDb } from '../../test-support/test-database';
import { RoomEventsService } from '../rooms/room-events.service';
import { RoomResolverService } from '../rooms/room-resolver.service';
import { RoomsService } from '../rooms/rooms.service';
import { CallsService } from './calls.service';
import { CallsWebhookService } from './calls-webhook.service';
import { CallSessionCloseService } from './call-session-close.service';

const config = new ConfigService({
  LIVEKIT_URL: 'wss://media.example.test',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: 'test-secret-at-least-32-characters-long',
});

describe('Herencia de admin durante una llamada (real Postgres)', () => {
  let ctx: ReturnType<typeof connectTestDb>;
  const roomIds: string[] = [];
  const userIds: string[] = [];
  const eventIds: string[] = [];

  beforeAll(() => {
    ctx = connectTestDb();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (eventIds.length)
      await ctx.db.delete(callEvents).where(inArray(callEvents.id, eventIds.splice(0)));
    if (roomIds.length) await ctx.db.delete(rooms).where(inArray(rooms.id, roomIds.splice(0)));
    if (userIds.length) await ctx.db.delete(users).where(inArray(users.id, userIds.splice(0)));
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function fixture() {
    const insertedUsers = await ctx.db
      .insert(users)
      .values(
        ['Creador', 'Heredero'].map((name) => ({
          name,
          email: `${randomUUID()}@test.date2gether`,
          passwordHash: 'x',
        })),
      )
      .returning();
    userIds.push(...insertedUsers.map((user) => user.id));
    const resolver = new RoomResolverService(ctx.db);
    const roomsService = new RoomsService(ctx.db, new RoomEventsService(), resolver);
    const room = await roomsService.createRoom('Sala heredada', insertedUsers[0].id);
    roomIds.push(room.id);
    const heir = insertedUsers[1];
    await ctx.db.insert(roomMembers).values({ roomId: room.id, userId: heir.id });
    const identity = randomUUID();
    await ctx.db.insert(callParticipantIdentities).values({
      livekitIdentity: identity,
      roomId: room.id,
      userId: heir.id,
      displayName: heir.name,
      roleAtIssue: 'participante',
    });
    return { room, heir, identity, roomsService, resolver, creatorId: insertedUsers[0].id };
  }

  it('solo un admin promovido sostiene el ingreso a la llamada sin el creador y conserva el snapshot histórico', async () => {
    const { room, heir, identity, roomsService, resolver, creatorId } = await fixture();
    vi.spyOn(RoomServiceClient.prototype, 'createRoom').mockResolvedValue({} as never);
    vi
      .spyOn(RoomServiceClient.prototype, 'listParticipants')
      .mockResolvedValue([{ identity } as ParticipantInfo]);
    const calls = new CallsService(roomsService, config, ctx.db, resolver);
    const guest = {
      kind: 'room-participant' as const,
      sub: randomUUID(),
      roomId: room.id,
      roomCode: room.code,
      name: 'Invitado',
    };

    await roomsService.setMemberRole(room.code, heir.id, 'colaborador', creatorId);
    await expect(calls.join(room.code, guest)).rejects.toBeInstanceOf(ForbiddenException);

    await roomsService.setMemberRole(room.code, heir.id, 'administrador', creatorId);
    await expect(calls.join(room.code, guest)).resolves.toHaveProperty('token');
    const [recorded] = await ctx.db
      .select()
      .from(callParticipantIdentities)
      .where(eq(callParticipantIdentities.livekitIdentity, identity));
    expect(recorded.roleAtIssue).toBe('participante');

    const close = new CallSessionCloseService(config, ctx.db);
    const schedule = vi.spyOn(global, 'setTimeout');
    try {
      await close.onAdminLeft('RM_role_inheritance', room.code);
      expect(schedule.mock.calls.some(([, delay]) => delay === 15_000)).toBe(false);
    } finally {
      close.cancelPending('RM_role_inheritance');
    }
  });

  it('la salida de quien fue promovido a admin dispara la comprobación de cierre', async () => {
    const { room, heir, identity, roomsService, creatorId } = await fixture();
    await roomsService.setMemberRole(room.code, heir.id, 'administrador', creatorId);
    const id = randomUUID();
    eventIds.push(id);
    vi.spyOn(WebhookReceiver.prototype, 'receive').mockResolvedValue({
      id,
      event: 'participant_left',
      createdAt: BigInt(Math.floor(Date.now() / 1000)),
      room: { sid: 'RM_role_inheritance', name: room.code },
      participant: { identity },
    } as WebhookEvent);
    const close = {
      onAdminLeft: vi.fn<CallSessionCloseService['onAdminLeft']>().mockResolvedValue(undefined),
    };
    const webhook = new CallsWebhookService(
      config,
      ctx.db,
      close as unknown as CallSessionCloseService,
    );

    await webhook.handle(Buffer.from('{}'), 'test-signature');

    expect(close.onAdminLeft).toHaveBeenCalledWith('RM_role_inheritance', room.code);
  });
});
