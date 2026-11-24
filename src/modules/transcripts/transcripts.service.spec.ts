import { describe, expect, it } from 'vitest';
import type { DrizzleDb } from '../../db/drizzle.module';
import type { TranscriptLine } from '../../db/schema';
import { chain, createFakeDb } from '../../test-support/fake-drizzle';
import { TRANSCRIPT_LIMIT, TranscriptsService } from './transcripts.service';

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
  const service = new TranscriptsService(db as unknown as DrizzleDb);
  return { db, service };
}

describe('TranscriptsService', () => {
  it('guarda la frase en la sala y la llamada indicadas y devuelve solo los campos públicos', async () => {
    const { db, service } = setup();
    const insertChain = chain([line]);
    db.insert.mockReturnValueOnce(insertChain);

    const saved = await service.save('room-1', 'RM_abc', 'Ana', 'Hola a todos');

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

    const transcript = await service.getCall('room-1', 'RM_abc');

    expect(transcript).toEqual([
      { id: 'line-1', speakerName: 'Ana', content: 'Hola a todos', spokenAt: line.spokenAt },
    ]);
    expect(selectChain.orderBy).toHaveBeenCalledTimes(1);
    expect(selectChain.limit).toHaveBeenCalledWith(TRANSCRIPT_LIMIT);
  });
});
