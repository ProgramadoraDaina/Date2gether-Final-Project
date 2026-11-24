import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoomAccessGuard } from '../auth/guards/room-access.guard';
import { RoomsController } from './rooms.controller';
import { RoomAccessService } from '../auth/room-access.service';
import { RoomsService } from './rooms.service';

describe('RoomsController', () => {
  let controller: RoomsController;
  let roomsService: {
    createRoom: Mock<(...args: unknown[]) => Promise<unknown>>;
    getByCodeOrThrow: Mock<(...args: unknown[]) => Promise<unknown>>;
    listOwnedRooms: Mock<(...args: unknown[]) => Promise<unknown>>;
    renameRoom: Mock<(...args: unknown[]) => Promise<unknown>>;
    setMemberRole: Mock<(...args: unknown[]) => Promise<unknown>>;
  };

  beforeEach(async () => {
    roomsService = {
      createRoom: vi.fn(),
      getByCodeOrThrow: vi.fn(),
      listOwnedRooms: vi.fn(),
      renameRoom: vi.fn(),
      setMemberRole: vi.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [RoomsController],
      providers: [
        { provide: RoomsService, useValue: roomsService },
        { provide: RoomAccessService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RoomAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(RoomsController);
  });

  it('GET /rooms/mine requiere autenticación y devuelve las salas que administra el usuario', async () => {
    const handler = Object.getOwnPropertyDescriptor(RoomsController.prototype, 'listMine')!
      .value as object;
    expect((Reflect.getMetadata('__guards__', handler) ?? []) as unknown[]).toContain(JwtAuthGuard);
    const owned = [{ id: 'r1', code: 'abc-defg-hij' }];
    roomsService.listOwnedRooms.mockResolvedValue(owned);

    await expect(controller.listMine({ sub: 'user-1' } as never)).resolves.toBe(owned);
    expect(roomsService.listOwnedRooms).toHaveBeenCalledWith('user-1');
  });

  it('reenvía el usuario autenticado para volver a verificar sus permisos dentro de la transacción', async () => {
    await controller.updateMemberRole(
      'abc-defg-hij',
      'member-1',
      { role: 'participante' },
      {
        sub: 'admin-1',
        email: 'admin@example.test',
      },
    );

    expect(roomsService.setMemberRole).toHaveBeenCalledWith(
      'abc-defg-hij',
      'member-1',
      'participante',
      'admin-1',
    );
  });

  it('declara /rooms/mine antes de /rooms/:code para que "mine" no se tome como código de sala', () => {
    const methods = Object.getOwnPropertyNames(RoomsController.prototype);
    expect(methods.indexOf('listMine')).toBeGreaterThan(-1);
    expect(methods.indexOf('listMine')).toBeLessThan(methods.indexOf('findOne'));
  });

  it('requiere autenticación para crear salas pero permite consultar el enlace', () => {
    const handler = Object.getOwnPropertyDescriptor(RoomsController.prototype, 'create')!
      .value as object;
    const guards = (Reflect.getMetadata('__guards__', handler) ?? []) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('delega la creación de la sala al RoomsService, con el nombre y el id del usuario autenticado', async () => {
    const fakeRoom = { id: 'room-1', code: 'abc-defg-hij', name: 'Reunión de Daina' };
    roomsService.createRoom.mockResolvedValue(fakeRoom);

    const result = await controller.create(
      { name: 'Reunión de Daina' },
      { sub: 'owner-123', email: 'a@example.test' },
    );

    expect(result).toEqual(fakeRoom);
    expect(roomsService.createRoom).toHaveBeenCalledWith('Reunión de Daina', 'owner-123', {
      isPermanent: undefined,
      slots: undefined,
    });
  });

  it('reenvía isPermanent y slots del DTO al RoomsService', async () => {
    const fakeRoom = { id: 'room-1', code: 'abc-defg-hij', name: 'Sala permanente' };
    roomsService.createRoom.mockResolvedValue(fakeRoom);
    const slots = [{ dayOfWeek: 2, timeOfDay: '07:00', timezone: 'UTC' }];

    await controller.create(
      { name: 'Sala permanente', isPermanent: true, slots },
      { sub: 'owner-123', email: 'a@example.test' },
    );

    expect(roomsService.createRoom).toHaveBeenCalledWith('Sala permanente', 'owner-123', {
      isPermanent: true,
      slots,
    });
  });

  it('delega la búsqueda de la sala al RoomsService con el código', async () => {
    const fakeRoom = { id: 'room-1', code: 'abc-defg-hij', name: 'Reunión de Daina' };
    roomsService.getByCodeOrThrow.mockResolvedValue(fakeRoom);

    const result = await controller.findOne('abc-defg-hij');

    expect(result).toEqual(fakeRoom);
    expect(roomsService.getByCodeOrThrow).toHaveBeenCalledWith('abc-defg-hij');
  });

  it('requiere rol administrador para renombrar una sala', () => {
    const handler = Object.getOwnPropertyDescriptor(RoomsController.prototype, 'renameRoom')!
      .value as object;
    expect(Reflect.getMetadata('__guards__', handler) ?? []).toEqual(
      expect.arrayContaining([expect.anything()]),
    );
    expect(Reflect.getMetadata('roomRoles', handler)).toEqual(['administrador']);
  });

  it('delega el renombre al RoomsService con el código y el nombre del DTO', async () => {
    roomsService.renameRoom.mockResolvedValue(undefined);

    const result = await controller.renameRoom('abc-defg-hij', { name: 'Grupo de los jueves' });

    expect(result).toEqual({ message: 'Nombre actualizado' });
    expect(roomsService.renameRoom).toHaveBeenCalledWith('abc-defg-hij', 'Grupo de los jueves');
  });
});
