import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy';
import { validate } from 'class-validator';
import type { DrizzleDb } from '../../db/drizzle.module';
import type { Room } from '../../db/schema';
import { SaveRoomNotesDto } from './dto/save-room-notes.dto';
import { RoomEventsService } from './room-events.service';
import { RoomsService } from './rooms.service';

describe('RoomsService: revisión de notas', () => {
  const room = { id: 'room-1', code: 'abc-defg-hij' } as Room;
  let query: jest.Mock<RemoteCallback>;
  let service: RoomsService;
  beforeEach(() => {
    // El proxy ejecuta los constructores SQL reales de Drizzle sin conectar a una BD.
    query = jest.fn<RemoteCallback>().mockResolvedValue({ rows: [] });
    service = new RoomsService(drizzle(query) as unknown as DrizzleDb, new RoomEventsService());
    jest.spyOn(service, 'getByCodeOrThrow').mockResolvedValue(room);
  });

  it('una nota inexistente devuelve la revisión inicial sin crear una fila', async () => {
    expect(await service.getRoomNotes(room.code)).toMatchObject({ content: '', revision: 0 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/^select /);
  });

  it('la primera escritura crea la revisión 1 sin sobrescribir una creación concurrente', async () => {
    query.mockResolvedValueOnce({ rows: [[room.id, 'Primera nota', 1, '2026-11-04 00:00:00']] });
    expect(await service.saveRoomNotes(room.code, 'Primera nota', 0)).toMatchObject({
      content: 'Primera nota',
      revision: 1,
    });
    expect(query.mock.calls[0][0]).toContain('on conflict do nothing');
    // PostgreSQL devuelve cero filas si otro participante creó la nota primero.
    await expect(service.saveRoomNotes(room.code, 'Copia obsoleta', 0)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('actualiza solo la sala y revisión esperadas e incrementa esa revisión', async () => {
    query.mockResolvedValueOnce({ rows: [[room.id, 'Nueva nota', 4, '2026-11-04 00:00:00']] });
    expect(await service.saveRoomNotes(room.code, 'Nueva nota', 3)).toMatchObject({
      content: 'Nueva nota',
      revision: 4,
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/^update "room_notes"/);
    expect(sql).toContain('where ("room_notes"."room_id" = $4 and "room_notes"."revision" = $5)');
    expect(params).toEqual(['Nueva nota', 4, expect.any(String), room.id, 3]);
  });

  it('rechaza una revisión obsoleta sin intentar luego un upsert', async () => {
    await expect(service.saveRoomNotes(room.code, 'Copia obsoleta', 3)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/^update /);
  });

  it('requiere una revisión entera válida y admite vaciar el contenido explícitamente', async () => {
    const dto = Object.assign(new SaveRoomNotesDto(), { content: '' });
    for (const revision of [undefined, -1, 1.5, '3']) {
      Object.assign(dto, { revision });
      expect((await validate(dto)).some((error) => error.property === 'revision')).toBe(true);
    }
    Object.assign(dto, { revision: 0 });
    expect(await validate(dto)).toHaveLength(0);
  });
});
