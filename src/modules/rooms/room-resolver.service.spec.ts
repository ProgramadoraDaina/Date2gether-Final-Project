import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DrizzleDb } from '../../db/drizzle.module';
import type { Room } from '../../db/schema';
import { chain, createFakeDb, type FakeDb } from '../../test-support/fake-drizzle';
import { RoomResolverService } from './room-resolver.service';

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    code: 'abc-defg-hij',
    name: 'Reunión de Daina',
    isActive: true,
    isPermanent: false,
    historyDeletedBefore: null,
    historyCleanupPending: false,
    lastEnteredAt: new Date(),
    retiredAt: null,
    waitingRoomEnabled: false,
    entryLocked: false,
    createdAt: new Date(),
    chimeMeetingId: null,
    ...overrides,
  };
}

describe('RoomResolverService', () => {
  let db: FakeDb;
  let resolver: RoomResolverService;

  beforeEach(() => {
    db = createFakeDb();
    resolver = new RoomResolverService(db as unknown as DrizzleDb);
  });

  describe('resolveJoinable', () => {
    it('devuelve la sala cuando la consulta (predicado de joinability) encuentra una fila', async () => {
      const room = makeRoom({ isPermanent: true });
      db.select.mockReturnValueOnce(chain([room]));

      await expect(resolver.resolveJoinable(room.code)).resolves.toBe(room);
    });

    it('lanza NotFoundException cuando el código nunca existió (fila vacía)', async () => {
      db.select.mockReturnValueOnce(chain([]));

      await expect(resolver.resolveJoinable('nunca-existio')).rejects.toThrow(NotFoundException);
    });

    it('lanza la MISMA NotFoundException cuando la sala está retirada o venció (indistinguible a propósito)', async () => {
      db.select.mockReturnValueOnce(chain([]));

      await expect(resolver.resolveJoinable('codigo-reciclado')).rejects.toThrow(
        new NotFoundException('No existe una sala con el código "codigo-reciclado"'),
      );
    });

    it('lanza ForbiddenException (distinto del 404) cuando la sala existe pero isActive=false', async () => {
      const room = makeRoom({ isActive: false });
      db.select.mockReturnValueOnce(chain([room]));

      await expect(resolver.resolveJoinable(room.code)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('lockJoinable', () => {
    it('bloquea la fila con FOR UPDATE dentro de la transacción dada', async () => {
      const room = makeRoom();
      const selectChain = chain([room]);
      const tx = { select: () => selectChain } as unknown as Parameters<
        typeof resolver.lockJoinable
      >[0];

      const result = await resolver.lockJoinable(tx, room.code);

      expect(result).toBe(room);
      expect(selectChain.for).toHaveBeenCalledWith('update');
    });

    it('con requireActive:false no rechaza una sala cerrada', async () => {
      const room = makeRoom({ isActive: false });
      const selectChain = chain([room]);
      const tx = { select: () => selectChain } as unknown as Parameters<
        typeof resolver.lockJoinable
      >[0];

      await expect(resolver.lockJoinable(tx, room.code, { requireActive: false })).resolves.toBe(
        room,
      );
    });
  });

  describe('assertBound', () => {
    it('lanza ForbiddenException cuando el roomId del participante no coincide con el de la sala', () => {
      const room = makeRoom({ id: 'room-real' });
      expect(() => resolver.assertBound({ roomId: 'room-ajeno' }, room)).toThrow(
        ForbiddenException,
      );
    });

    it('no lanza cuando el roomId coincide', () => {
      const room = makeRoom({ id: 'room-real' });
      expect(() => resolver.assertBound({ roomId: 'room-real' }, room)).not.toThrow();
    });
  });

  describe('findPoolOccupant (2.22: único lugar que consulta rooms por código, incluido el probe de colisión de createRoom)', () => {
    it('devuelve la sala que ocupa ese código en el pool (retired_at IS NULL)', async () => {
      const room = makeRoom();
      db.select.mockReturnValueOnce(chain([room]));

      await expect(resolver.findPoolOccupant(room.code)).resolves.toBe(room);
    });

    it('devuelve undefined si ningún código vigente lo ocupa', async () => {
      db.select.mockReturnValueOnce(chain([]));

      await expect(resolver.findPoolOccupant('codigo-libre')).resolves.toBeUndefined();
    });

    it('[4.11] usa la transacción dada en vez de this.db cuando se pasa una -- el probe de colisión debe correr dentro de la tx de createRoom', async () => {
      const room = makeRoom();
      const selectChain = chain([room]);
      const tx = { select: () => selectChain } as unknown as Parameters<
        typeof resolver.findPoolOccupant
      >[1];

      await expect(resolver.findPoolOccupant(room.code, tx)).resolves.toBe(room);
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('devuelve la sala por id sin aplicar el predicado de joinability', async () => {
      const room = makeRoom({ retiredAt: new Date() });
      db.select.mockReturnValueOnce(chain([room]));

      await expect(resolver.getById(room.id)).resolves.toBe(room);
    });

    it('devuelve undefined si el id no existe', async () => {
      db.select.mockReturnValueOnce(chain([]));

      await expect(resolver.getById('no-existe')).resolves.toBeUndefined();
    });
  });

  describe('touchEntry', () => {
    it('actualiza last_entered_at para la sala dada', async () => {
      const updateChain = chain([]);
      db.update.mockReturnValueOnce(updateChain);

      await resolver.touchEntry('room-1');

      expect(db.update).toHaveBeenCalled();
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ lastEnteredAt: expect.anything() }),
      );
    });

    it('usa la transacción dada en vez de this.db cuando se pasa una', async () => {
      const updateChain = chain([]);
      const tx = { update: () => updateChain } as unknown as Parameters<
        typeof resolver.touchEntry
      >[1];

      await resolver.touchEntry('room-1', tx);

      expect(db.update).not.toHaveBeenCalled();
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ lastEnteredAt: expect.anything() }),
      );
    });
  });

  describe('retireExpired', () => {
    it('ejecuta el sweep de retiro sobre rooms dentro de la transacción dada', async () => {
      const updateChain = chain([]);
      const tx = { update: () => updateChain } as unknown as Parameters<
        typeof resolver.retireExpired
      >[0];

      await resolver.retireExpired(tx);

      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ retiredAt: expect.anything() }),
      );
      expect(updateChain.where).toHaveBeenCalled();
    });
  });
});
