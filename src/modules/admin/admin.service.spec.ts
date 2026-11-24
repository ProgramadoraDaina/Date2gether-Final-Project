import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DrizzleDb } from '../../db/drizzle.module';
import { chain, createFakeDb, type FakeDb } from '../../test-support/fake-drizzle';
import type { RoomsService } from '../rooms/rooms.service';
import { AdminService } from './admin.service';

const targetView = {
  id: 'user-2',
  email: 'b@example.test',
  name: 'Beto',
  role: 'admin' as const,
  createdAt: new Date(),
};

describe('AdminService', () => {
  let db: FakeDb;
  let roomsService: { deleteRoom: ReturnType<typeof vi.fn> };
  let service: AdminService;

  beforeEach(() => {
    db = createFakeDb();
    roomsService = { deleteRoom: vi.fn().mockResolvedValue(undefined) };
    service = new AdminService(db as unknown as DrizzleDb, roomsService as unknown as RoomsService);
  });

  describe('setUserRole', () => {
    it('impide que un admin se quite el rol a sí mismo, sin tocar la base', async () => {
      await expect(service.setUserRole('user-1', 'user-1', 'user')).rejects.toThrow(
        BadRequestException,
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    it('permite que un admin se "asigne" admin a sí mismo (no-op inofensivo)', async () => {
      const updateChain = chain([{ ...targetView, id: 'user-1' }]);
      db.update.mockReturnValueOnce(updateChain);

      await expect(service.setUserRole('user-1', 'user-1', 'admin')).resolves.toMatchObject({
        id: 'user-1',
      });
    });

    it('cambia el rol de otra cuenta y devuelve la vista sin hash', async () => {
      const updateChain = chain([targetView]);
      db.update.mockReturnValueOnce(updateChain);

      const result = await service.setUserRole('user-1', 'user-2', 'admin');

      expect(updateChain.set).toHaveBeenCalledWith({ role: 'admin' });
      expect(result).toEqual(targetView);
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('responde 404 si la cuenta objetivo no existe', async () => {
      db.update.mockReturnValueOnce(chain([]));

      await expect(service.setUserRole('user-1', 'user-9', 'user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listUsers', () => {
    it('lista usuarios con id, email, nombre, rol y fecha, sin el hash de contraseña', async () => {
      const selectChain = chain([targetView]);
      db.select.mockReturnValueOnce(selectChain);

      const result = await service.listUsers();

      expect(result).toEqual([targetView]);
      expect(selectChain.from).toHaveBeenCalledTimes(1);
      const selectedColumns = db.select.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.keys(selectedColumns).sort()).toEqual([
        'createdAt',
        'email',
        'id',
        'name',
        'role',
      ]);
    });
  });

  describe('deleteRoom', () => {
    it('reutiliza el borrado de RoomsService', async () => {
      await service.deleteRoom('abc-defg-hij');

      expect(roomsService.deleteRoom).toHaveBeenCalledWith('abc-defg-hij');
    });

    it('propaga el 404 de RoomsService cuando la sala no existe', async () => {
      roomsService.deleteRoom.mockRejectedValueOnce(new NotFoundException());

      await expect(service.deleteRoom('zzz-zzzz-zzz')).rejects.toThrow(NotFoundException);
    });
  });
});
