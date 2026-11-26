import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { rooms } from '../../db/schema';
import { connectTestDb } from '../../test-support/test-database';
import { RoomResolverService } from './room-resolver.service';

// Task 2.20 (room-permanence spec.md lines 47-57). The rolling 24h window
// is enforced entirely inside the SQL predicate built in room-resolver.
// service.ts -- `gt(lastEnteredAt, now() - interval '24 hours')` runs on
// Postgres, not in JS -- so a fake Drizzle (which just returns canned rows
// regardless of the WHERE clause) cannot exercise it; this needs the real
// disposable test database (docker-compose.test.yml, `pnpm test:e2e:setup`).
//
// Hour marks from the spec ("hour 0", "hour 23", "hour 47", "hour 48") are
// simulated as deltas from the real `now()` at test time, using a small
// margin (±1 minute) around the 24h boundary instead of the literal
// integer hours -- the predicate is a strict `>`, so testing at an exact
// 24h delta would be a timing race against the SQL clock, not a real
// assertion about which side of the boundary the room falls on.
describe('RoomResolverService — rolling-window regression (real Postgres)', () => {
  let ctx: ReturnType<typeof connectTestDb>;
  const insertedIds: string[] = [];

  beforeAll(() => {
    ctx = connectTestDb();
  });

  afterEach(async () => {
    while (insertedIds.length > 0) {
      const id = insertedIds.pop()!;
      await ctx.db.delete(rooms).where(eq(rooms.id, id));
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function insertRoom(lastEnteredAt: Date): Promise<string> {
    const [room] = await ctx.db
      .insert(rooms)
      .values({
        code: `rw-${randomUUID().slice(0, 8)}`,
        name: 'Sala de prueba de ventana rodante',
        isPermanent: false,
        lastEnteredAt,
        retiredAt: null,
      })
      .returning();
    insertedIds.push(room.id);
    return room.code;
  }

  it('room re-entered shortly before the 24h cutoff from that re-entry is still joinable (window rolled forward)', async () => {
    // hour 0 entered, hour 23 re-entered, checked at ~hour 47: the window
    // rolled on the hour-23 entry, so what matters is "just under 24h since
    // THAT entry", not since hour 0.
    const almostTwentyFourHoursAgo = new Date(Date.now() - (24 * 60 - 1) * 60 * 1000);
    const code = await insertRoom(almostTwentyFourHoursAgo);
    const resolver = new RoomResolverService(ctx.db);

    await expect(resolver.resolveJoinable(code)).resolves.toMatchObject({ code });
  });

  it('room not re-entered after the earlier entry is unjoinable past the 24h cutoff', async () => {
    // Same room's last entry stands at hour 23 with no renewal; checked at
    // ~hour 48 — more than 24h have elapsed since that last entry.
    const justOverTwentyFourHoursAgo = new Date(Date.now() - (24 * 60 + 1) * 60 * 1000);
    const code = await insertRoom(justOverTwentyFourHoursAgo);
    const resolver = new RoomResolverService(ctx.db);

    await expect(resolver.resolveJoinable(code)).rejects.toThrow(NotFoundException);
  });
});
