import { describe, expect, it, jest } from '@jest/globals';
import type { DrizzleDb } from '../../db/drizzle.module';
import type { Room, TranscriptLine } from '../../db/schema';
import { chain, createFakeDb } from '../../test-support/fake-drizzle';
import type { RoomsService } from '../rooms/rooms.service';
import { TRANSCRIPT_LIMIT, TranscriptsService } from './transcripts.service';

const room = { id: 'room-1', code: 'abc-defg-hij' } as Room;
const line: TranscriptLine = {
  id: 'line-1',
  roomId: 'room-1',
  callSid: 'RM_abc',
  speakerName: 'Ana',
  content: 'Hola a todos',
  spokenAt: new Date('2026-11-06T20:01:05Z'),
};

function setup() {
  const db = createFakeDb();
  const rooms = { getByCodeOrThrow: jest.fn<RoomsService['getByCodeOrThrow']>() };
  rooms.getByCodeOrThrow.mockResolvedValue(room);
  const service = new TranscriptsService(
    rooms as unknown as RoomsService,
    db as unknown as DrizzleDb,
  );
  return { db, rooms, service };
}

describe('TranscriptsService', () => {
  it('guarda la frase en la sala y la llamada indicadas y devuelve solo los campos públicos', async () => {
    const { db, rooms, service } = setup();
    const insertChain = chain([line]);
    db.insert.mockReturnValueOnce(insertChain);

    const saved = await service.save('abc-defg-hij', 'RM_abc', 'Ana', 'Hola a todos');

    expect(rooms.getByCodeOrThrow).toHaveBeenCalledWith('abc-defg-hij');
    expect(insertChain.values).toHaveBeenCalledWith({
      roomId: 'room-1',
      callSid: 'RM_abc',
      speakerName: 'Ana',
      content: 'Hola a todos',
    });
    expect(saved).toEqual({
      id: 'line-1',
      speakerName: 'Ana',
      content: 'Hola a todos',
      spokenAt: line.spokenAt,
    });
  });

  it('devuelve el acta de una llamada en orden y con tope de frases', async () => {
    const { db, service } = setup();
    const selectChain = chain([line]);
    db.select.mockReturnValueOnce(selectChain);

    const transcript = await service.getCall('abc-defg-hij', 'RM_abc');

    expect(transcript).toEqual([
      { id: 'line-1', speakerName: 'Ana', content: 'Hola a todos', spokenAt: line.spokenAt },
    ]);
    expect(selectChain.orderBy).toHaveBeenCalledTimes(1);
    expect(selectChain.limit).toHaveBeenCalledWith(TRANSCRIPT_LIMIT);
  });

  it('si la sala no existe no toca la base', async () => {
    const { db, rooms, service } = setup();
    rooms.getByCodeOrThrow.mockRejectedValueOnce(new Error('No existe'));
    await expect(service.save('nope', 'RM_abc', 'Ana', 'hola')).rejects.toThrow('No existe');
    expect(db.insert).not.toHaveBeenCalled();
  });
});
