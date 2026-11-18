import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../db/drizzle.module';
import { roomPlaylists, type PlaylistTrack } from '../../db/schema';

export interface StoredPlaylist {
  tracks: PlaylistTrack[];
  currentIndex: number;
}

@Injectable()
export class RoomPlaylistsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async load(roomId: string): Promise<StoredPlaylist | null> {
    const [row] = await this.db
      .select({ tracks: roomPlaylists.tracks, currentIndex: roomPlaylists.currentIndex })
      .from(roomPlaylists)
      .where(eq(roomPlaylists.roomId, roomId));
    return row ?? null;
  }

  async save(roomId: string, tracks: PlaylistTrack[], currentIndex: number): Promise<void> {
    const values = { tracks, currentIndex, updatedAt: new Date() };
    await this.db
      .insert(roomPlaylists)
      .values({ roomId, ...values })
      .onConflictDoUpdate({ target: roomPlaylists.roomId, set: values });
  }
}
