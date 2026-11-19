import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { roomPlaylists, rooms } from '../../db/schema';
import { connectTestDb } from '../../test-support/test-database';
import { RoomPlaylistsService } from './room-playlists.service';

describe('RoomPlaylistsService (real Postgres)', () => {
  let ctx: ReturnType<typeof connectTestDb>;
  const insertedRoomIds: string[] = [];

  beforeAll(() => {
    ctx = connectTestDb();
  });

  afterEach(async () => {
    while (insertedRoomIds.length > 0) {
      await ctx.db.delete(rooms).where(eq(rooms.id, insertedRoomIds.pop()!));
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function insertRoom() {
    const [room] = await ctx.db
      .insert(rooms)
      .values({ code: `pl-${randomUUID().slice(0, 8)}`, name: 'Cita', isPermanent: true })
      .returning();
    insertedRoomIds.push(room.id);
    return room;
  }

  it('devuelve null si la sala nunca guardó una playlist', async () => {
    const room = await insertRoom();

    await expect(new RoomPlaylistsService(ctx.db).load(room.id)).resolves.toBeNull();
  });

  it('guarda la playlist y la vuelve a cargar; un segundo guardado la reemplaza', async () => {
    const room = await insertRoom();
    const service = new RoomPlaylistsService(ctx.db);

    await service.save(room.id, [{ videoId: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody' }], 0);
    await service.save(
      room.id,
      [
        { videoId: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody' },
        { videoId: 'vbvyNnw8Qjg', title: 'Live Aid 1985' },
      ],
      1,
    );

    await expect(service.load(room.id)).resolves.toEqual({
      tracks: [
        { videoId: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody' },
        { videoId: 'vbvyNnw8Qjg', title: 'Live Aid 1985' },
      ],
      currentIndex: 1,
    });
    const rows = await ctx.db.select().from(roomPlaylists).where(eq(roomPlaylists.roomId, room.id));
    expect(rows).toHaveLength(1);
  });

  it('se borra junto con la sala', async () => {
    const room = await insertRoom();
    await new RoomPlaylistsService(ctx.db).save(room.id, [{ videoId: 'a', title: 'b' }], 0);

    await ctx.db.delete(rooms).where(eq(rooms.id, room.id));

    const rows = await ctx.db.select().from(roomPlaylists).where(eq(roomPlaylists.roomId, room.id));
    expect(rows).toHaveLength(0);
  });
});
