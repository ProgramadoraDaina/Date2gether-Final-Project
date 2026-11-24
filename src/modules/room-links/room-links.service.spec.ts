import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy';
import { validate } from 'class-validator';
import type { DrizzleDb } from '../../db/drizzle.module';
import type { Room } from '../../db/schema';
import { RoomEventsService } from '../rooms/room-events.service';
import type { RoomsService } from '../rooms/rooms.service';
import { CreateRoomLinkDto } from './dto/create-room-link.dto';
import { RoomLinksService } from './room-links.service';

const LINK_ROW = [
  'link-1',
  'room-1',
  'https://docs.example.com/clase-1',
  'Apunte clase 1',
  'Santi',
  '2026-11-24 10:00:00',
];

describe('RoomLinksService', () => {
  const permanentRoom = { id: 'room-1', code: 'abc-defg-hij', isPermanent: true } as Room;
  let query: Mock<RemoteCallback>;
  let events: RoomEventsService;
  let changed: Mock<(event: { roomCode: string }) => void>;
  let getByCodeOrThrow: Mock<(code: string) => Promise<Room>>;
  let service: RoomLinksService;

  beforeEach(() => {
    query = vi.fn<RemoteCallback>().mockResolvedValue({ rows: [] });
    events = new RoomEventsService();
    changed = vi.fn();
    events.onRoomLinksChanged(changed);
    getByCodeOrThrow = vi.fn().mockResolvedValue(permanentRoom);
    service = new RoomLinksService(
      drizzle(query) as unknown as DrizzleDb,
      { getByCodeOrThrow } as unknown as RoomsService,
      events,
    );
  });

  it('lista los links de la sala, el más nuevo primero', async () => {
    query.mockResolvedValueOnce({ rows: [LINK_ROW] });
    expect(await service.list('room-1')).toEqual([
      expect.objectContaining({ url: 'https://docs.example.com/clase-1', addedByName: 'Santi' }),
    ]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('where "room_links"."room_id" = $1');
    expect(sql).toContain('order by "room_links"."created_at" desc');
    expect(params).toEqual(['room-1']);
  });

  it('guarda el link con el nombre de quien lo agrega y avisa a la sala', async () => {
    query.mockResolvedValueOnce({ rows: [['Santi']] }).mockResolvedValueOnce({ rows: [LINK_ROW] });
    const link = await service.add(permanentRoom.code, 'user-1', {
      url: 'https://docs.example.com/clase-1',
      title: '  Apunte clase 1  ',
    });
    expect(link).toMatchObject({ id: 'link-1', title: 'Apunte clase 1' });
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/^insert into "room_links"/);
    expect(sql).toContain('on conflict do nothing');
    expect(params).toEqual([
      'room-1',
      'https://docs.example.com/clase-1',
      'Apunte clase 1',
      'Santi',
    ]);
    expect(changed).toHaveBeenCalledWith({ roomCode: permanentRoom.code });
  });

  it('un título vacío se guarda como null', async () => {
    query.mockResolvedValueOnce({ rows: [['Santi']] }).mockResolvedValueOnce({ rows: [LINK_ROW] });
    await service.add(permanentRoom.code, 'user-1', { url: 'https://a.com', title: '   ' });
    expect(query.mock.calls[1][1]).toEqual(['room-1', 'https://a.com', null, 'Santi']);
  });

  it('rechaza un link repetido en la misma sala sin avisar a la sala', async () => {
    query.mockResolvedValueOnce({ rows: [['Santi']] }).mockResolvedValueOnce({ rows: [] });
    await expect(
      service.add(permanentRoom.code, 'user-1', { url: 'https://docs.example.com/clase-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(changed).not.toHaveBeenCalled();
  });

  it('una sala temporal no tiene biblioteca: no escribe nada', async () => {
    getByCodeOrThrow.mockResolvedValue({ ...permanentRoom, isPermanent: false });
    await expect(
      service.add(permanentRoom.code, 'user-1', { url: 'https://a.com' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('borra solo un link de esa sala y avisa a la sala', async () => {
    query.mockResolvedValueOnce({ rows: [['link-1']] });
    await service.remove(permanentRoom.code, 'link-1');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/^delete from "room_links"/);
    expect(sql).toContain('where ("room_links"."id" = $1 and "room_links"."room_id" = $2)');
    expect(params).toEqual(['link-1', 'room-1']);
    expect(changed).toHaveBeenCalledWith({ roomCode: permanentRoom.code });
  });

  it('borrar un link inexistente (u de otra sala) da 404', async () => {
    await expect(service.remove(permanentRoom.code, 'link-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('CreateRoomLinkDto', () => {
  async function errorsFor(values: Record<string, unknown>) {
    return (await validate(Object.assign(new CreateRoomLinkDto(), values))).map((e) => e.property);
  }

  it('acepta http y https con título opcional', async () => {
    expect(await errorsFor({ url: 'https://docs.example.com/a?b=1' })).toEqual([]);
    expect(await errorsFor({ url: 'http://example.com', title: 'Apunte' })).toEqual([]);
  });

  it('rechaza esquemas peligrosos, URLs sin protocolo y textos demasiado largos', async () => {
    for (const url of ['javascript:alert(1)', 'example.com', 'ftp://example.com', '', 42]) {
      expect(await errorsFor({ url })).toContain('url');
    }
    expect(await errorsFor({ url: `https://a.com/${'x'.repeat(2048)}` })).toContain('url');
    expect(await errorsFor({ url: 'https://a.com', title: 'x'.repeat(121) })).toContain('title');
  });
});
