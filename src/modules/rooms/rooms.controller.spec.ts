import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoomsController } from './rooms.controller';
import { RoomAccessService } from '../auth/room-access.service';
import { RoomsService } from './rooms.service';

describe('RoomsController', () => {
  let controller: RoomsController;
  let roomsService: {
    createRoom: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    getByCodeOrThrow: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };

  beforeEach(async () => {
    roomsService = {
      createRoom: jest.fn(),
      getByCodeOrThrow: jest.fn(),
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
      .compile();

    controller = module.get(RoomsController);
  });

  it('requiere autenticación para crear salas pero permite consultar el enlace', () => {
    const handler = Object.getOwnPropertyDescriptor(RoomsController.prototype, 'create')!
      .value as object;
    const guards = (Reflect.getMetadata('__guards__', handler) ?? []) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('delega la creación de la sala al RoomsService con el nombre', async () => {
    const fakeRoom = { id: 'room-1', code: 'abc-defg-hij', name: 'Reunión de Daina' };
    roomsService.createRoom.mockResolvedValue(fakeRoom);

    const result = await controller.create(
      { name: 'Reunión de Daina' },
      { sub: 'owner-123', email: 'a@example.test' },
    );

    expect(result).toEqual(fakeRoom);
    expect(roomsService.createRoom).toHaveBeenCalledWith('Reunión de Daina', 'owner-123');
  });

  it('delega la búsqueda de la sala al RoomsService con el código', async () => {
    const fakeRoom = { id: 'room-1', code: 'abc-defg-hij', name: 'Reunión de Daina' };
    roomsService.getByCodeOrThrow.mockResolvedValue(fakeRoom);

    const result = await controller.findOne('abc-defg-hij');

    expect(result).toEqual(fakeRoom);
    expect(roomsService.getByCodeOrThrow).toHaveBeenCalledWith('abc-defg-hij');
  });
});
