import { describe, expect, it, jest } from '@jest/globals';
import { RoomAccessGuard } from '../auth/guards/room-access.guard';
import { MusicSearchController } from './music-search.controller';
import type { MusicSearchService } from './music-search.service';

describe('MusicSearchController', () => {
  it('está protegido por RoomAccessGuard para que nadie de afuera gaste la cuota', () => {
    const guards = (Reflect.getMetadata('__guards__', MusicSearchController) ?? []) as unknown[];
    expect(guards).toContain(RoomAccessGuard);
  });

  it('delega la búsqueda en MusicSearchService con el texto', async () => {
    const results = [{ videoId: 'a', title: 'b', channel: 'c', thumbnailUrl: 'd' }];
    const service = { search: jest.fn<MusicSearchService['search']>().mockResolvedValue(results) };
    const controller = new MusicSearchController(service as unknown as MusicSearchService);

    await expect(controller.search({ q: 'queen' })).resolves.toBe(results);
    expect(service.search).toHaveBeenCalledWith('queen');
  });
});
