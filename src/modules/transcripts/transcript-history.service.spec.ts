import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { DrizzleDb } from '../../db/drizzle.module';
import { chain, createFakeDb } from '../../test-support/fake-drizzle';
import { TranscriptHistoryService } from './transcript-history.service';
import type { TranscriptEntry, TranscriptsService } from './transcripts.service';

const entry: TranscriptEntry = {
  id: 'line-1',
  speakerName: 'Ana',
  content: 'me encanta esta aplicacion',
  spokenAt: new Date('2026-11-18T20:01:05Z'),
};

function setup(sessionRows: object[]) {
  const db = createFakeDb();
  const sessionChain = chain(sessionRows);
  db.select.mockReturnValueOnce(sessionChain);
  const transcripts = { getCall: vi.fn<TranscriptsService['getCall']>() };
  transcripts.getCall.mockResolvedValue([entry]);
  const service = new TranscriptHistoryService(
    db as unknown as DrizzleDb,
    transcripts as unknown as TranscriptsService,
  );
  return { sessionChain, transcripts, service };
}

describe('TranscriptHistoryService', () => {
  it('quien participó de la sesión ve el acta de esa llamada (sala + sid de LiveKit)', async () => {
    const { sessionChain, transcripts, service } = setup([
      { id: 'session-1', roomId: 'room-1', livekitRoomSid: 'RM_abc' },
    ]);

    await expect(service.getForSession('session-1', 'user-1')).resolves.toEqual([entry]);

    expect(sessionChain.innerJoin).toHaveBeenCalledTimes(1);
    expect(transcripts.getCall).toHaveBeenCalledWith('room-1', 'RM_abc');
  });

  it('si no participó (o la sesión no existe) responde 404 sin leer el acta', async () => {
    const { transcripts, service } = setup([]);
    await expect(service.getForSession('session-1', 'otro')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(transcripts.getCall).not.toHaveBeenCalled();
  });

  it('si la sala se borró, la sesión sigue pero el acta queda vacía', async () => {
    const { transcripts, service } = setup([
      { id: 'session-1', roomId: null, livekitRoomSid: 'RM_abc' },
    ]);
    await expect(service.getForSession('session-1', 'user-1')).resolves.toEqual([]);
    expect(transcripts.getCall).not.toHaveBeenCalled();
  });

  it('resuelve el sid de LiveKit a la sesión del historial solo para quien participó', async () => {
    const found = setup([{ id: 'session-1', roomId: 'room-1', livekitRoomSid: 'RM_abc' }]);
    await expect(found.service.resolveBySid('RM_abc', 'user-1')).resolves.toEqual({
      id: 'session-1',
    });

    const missing = setup([]);
    await expect(missing.service.resolveBySid('RM_abc', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
