import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { RoomServiceClient, TokenVerifier } from 'livekit-server-sdk';
import type { Room } from '../../db/schema';
import type { RoomParticipant } from '../auth/room-access.service';
import { RoomsService } from '../rooms/rooms.service';
import { CallsService } from './calls.service';

const participant: RoomParticipant = {
  kind: 'room-participant',
  sub: 'guest-1',
  roomCode: 'abc-defg-hij',
  name: 'Ana',
};
const room = { id: 'room-1', code: participant.roomCode, isActive: true } as Room;
const secret = 'test-secret-at-least-32-characters-long';
const config = {
  LIVEKIT_URL: 'wss://media.example.com',
  LIVEKIT_API_URL: 'http://localhost:7880',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: secret,
  MAX_ROOM_PARTICIPANTS: '6',
};

describe('CallsService: LiveKit', () => {
  let rooms: { getByCodeOrThrow: jest.Mock<RoomsService['getByCodeOrThrow']> };
  let createRoom: jest.SpiedFunction<RoomServiceClient['createRoom']>;
  let service: CallsService;
  beforeEach(() => {
    rooms = {
      getByCodeOrThrow: jest.fn<RoomsService['getByCodeOrThrow']>().mockResolvedValue(room),
    };
    createRoom = jest
      .spyOn(RoomServiceClient.prototype, 'createRoom')
      .mockResolvedValue({} as Awaited<ReturnType<RoomServiceClient['createRoom']>>);
    service = new CallsService(rooms as unknown as RoomsService, new ConfigService(config));
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('firma un token de invitado limitado a su sala con el nombre confirmado', async () => {
    const session = await service.join(room.code, participant);
    const claims = await new TokenVerifier(config.LIVEKIT_API_KEY, secret).verify(session.token);
    expect(claims.sub).toBe(participant.sub);
    expect(claims.name).toBe('Ana');
    expect(claims.video).toMatchObject({
      room: room.code,
      roomJoin: true,
      roomAdmin: false,
      roomRecord: false,
      canPublishData: false,
    });
    expect(session.url).toBe('wss://media.example.com');
    expect(session.participantLimit).toBe(6);
    expect(JSON.stringify(session)).not.toContain(secret);
    expect(JSON.stringify(session)).not.toContain('http://localhost:7880');
  });

  it('configura el cupo en LiveKit y el cierre por inactividad', async () => {
    await service.join(room.code, participant);
    expect(createRoom).toHaveBeenCalledWith({
      name: room.code,
      maxParticipants: 6,
      emptyTimeout: 300,
      departureTimeout: 30,
    });
  });

  it('usa la misma sala ante solicitudes concurrentes y distingue identidades', async () => {
    const results = await Promise.all([
      service.join(room.code, participant),
      service.join(room.code, { ...participant, sub: 'guest-2', name: 'Ana' }),
    ]);
    expect(results[0].roomName).toBe(results[1].roomName);
    const verifier = new TokenVerifier(config.LIVEKIT_API_KEY, secret);
    expect((await verifier.verify(results[0].token)).sub).not.toBe(
      (await verifier.verify(results[1].token)).sub,
    );
  });

  it('rechaza un pase de otra sala', async () => {
    await expect(service.join('other-room', participant)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('rechaza una sala cerrada antes de contactar LiveKit', async () => {
    rooms.getByCodeOrThrow.mockResolvedValue({ ...room, isActive: false });
    await expect(service.join(room.code, participant)).rejects.toThrow('La sala está cerrada');
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('informa si falta configuración sin contactar al servicio', async () => {
    service = new CallsService(rooms as unknown as RoomsService, new ConfigService({}));
    await expect(service.join(room.code, participant)).rejects.toThrow(
      'Las llamadas todavía no están configuradas',
    );
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('no convierte valores inválidos en un cupo ilimitado', async () => {
    service = new CallsService(
      rooms as unknown as RoomsService,
      new ConfigService({ ...config, MAX_ROOM_PARTICIPANTS: '0' }),
    );
    await expect(service.join(room.code, participant)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('no expone respuestas internas del servidor de medios', async () => {
    createRoom.mockRejectedValueOnce(new Error('private server credentials'));
    await expect(service.join(room.code, participant)).rejects.toThrow(
      'El servidor de llamadas no está disponible. Intentá nuevamente.',
    );
  });
});
