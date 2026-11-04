import { describe, expect, it } from '@jest/globals';
import type { DrizzleDb } from '../../db/drizzle.module';
import type { Message } from '../../db/schema';
import { chain, createFakeDb } from '../../test-support/fake-drizzle';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  it('devuelve el historial de la sala ordenado ascendente por fecha de creación', async () => {
    const db = createFakeDb();
    const messages: Message[] = [
      {
        id: '1',
        roomId: 'room-1',
        authorName: 'Ana',
        content: 'hola',
        createdAt: new Date('2026-01-01'),
      },
      {
        id: '2',
        roomId: 'room-1',
        authorName: 'Bea',
        content: 'hola de nuevo',
        createdAt: new Date('2026-01-02'),
      },
    ];
    db.select.mockReturnValueOnce(chain(messages));
    const service = new ChatService(db as unknown as DrizzleDb);

    const history = await service.getHistory('room-1');

    expect(history).toBe(messages);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('inserta el mensaje con sala, autor y contenido, y devuelve lo creado', async () => {
    const db = createFakeDb();
    const created: Message = {
      id: '1',
      roomId: 'room-1',
      authorName: 'Ana',
      content: 'hola',
      createdAt: new Date(),
    };
    const insertChain = chain([created]);
    db.insert.mockReturnValueOnce(insertChain);
    const service = new ChatService(db as unknown as DrizzleDb);

    const result = await service.createMessage('room-1', 'Ana', 'hola');

    expect(result).toEqual(created);
    expect(insertChain.values).toHaveBeenCalledWith({
      roomId: 'room-1',
      authorName: 'Ana',
      content: 'hola',
    });
  });
});
