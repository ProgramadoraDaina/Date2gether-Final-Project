import { describe, expect, it, vi } from 'vitest';
import { RoomAccessGuard } from '../auth/guards/room-access.guard';
import { GifsController } from './gifs.controller';
import type { GifsService } from './gifs.service';

// Accepted cost (D4, tasks.md 2.21): GifsController ya estaba protegido por
// RoomAccessGuard y antes nunca tocaba la base; ahora paga un SELECT
// indexado por búsqueda (resolveJoinable + assertBound). No hace falta
// cambiar el controller -- solo confirmar que sigue delegando bien.
describe('GifsController', () => {
  it('sigue protegido por RoomAccessGuard (ahora resuelve la sala real antes de autorizar)', () => {
    const guards = (Reflect.getMetadata('__guards__', GifsController) ?? []) as unknown[];
    expect(guards).toContain(RoomAccessGuard);
  });

  it('delega la búsqueda en GifsService con el texto y el offset, para una sala válida y vinculada', async () => {
    const page = { results: [], nextOffset: null };
    const gifsService = { search: vi.fn<GifsService['search']>().mockResolvedValue(page) };
    const controller = new GifsController(gifsService as unknown as GifsService);

    const result = await controller.search({ q: 'gato', offset: 24 });

    expect(result).toBe(page);
    expect(gifsService.search).toHaveBeenCalledWith('gato', 24);
  });
});
