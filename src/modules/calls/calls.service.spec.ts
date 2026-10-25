import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  ChimeSDKMeetingsClient,
  CreateAttendeeCommand,
  CreateMeetingCommand,
  GetMeetingCommand,
  NotFoundException,
} from '@aws-sdk/client-chime-sdk-meetings';
import type { Room } from '../../db/schema';
import { RoomsService } from '../rooms/rooms.service';
import { CallsService } from './calls.service';

jest.mock('@aws-sdk/client-chime-sdk-meetings');

function buildRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    code: 'ABC123',
    name: 'Reunión de Daina',
    isActive: true,
    createdAt: new Date(),
    chimeMeetingId: null,
    ...overrides,
  };
}

describe('CallsService', () => {
  let service: CallsService;
  let send: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let roomsService: {
    getByCodeOrThrow: jest.Mock<(...args: unknown[]) => Promise<Room>>;
    setChimeMeetingId: jest.Mock<(...args: unknown[]) => Promise<void>>;
  };

  beforeEach(() => {
    send = jest.fn();
    const client = { send } as unknown as ChimeSDKMeetingsClient;
    roomsService = {
      getByCodeOrThrow: jest.fn<(...args: unknown[]) => Promise<Room>>(),
      setChimeMeetingId: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(),
    };
    service = new CallsService(client, roomsService as unknown as RoomsService);
  });

  it('crea una reunión de Chime nueva si la sala todavía no tiene una, y la persiste', async () => {
    roomsService.getByCodeOrThrow.mockResolvedValue(buildRoom({ chimeMeetingId: null }));
    const fakeMeeting = { MeetingId: 'meeting-123', ExternalMeetingId: 'ABC123' };
    send.mockResolvedValue({ Meeting: fakeMeeting });

    const meeting = await service.createMeetingForRoom('ABC123');

    expect(meeting).toEqual(fakeMeeting);
    expect(send).toHaveBeenCalledTimes(1);

    const command = send.mock.calls[0][0] as CreateMeetingCommand;
    expect(command).toBeInstanceOf(CreateMeetingCommand);
    expect(command.input).toMatchObject({
      ExternalMeetingId: 'ABC123',
      MediaRegion: 'sa-east-1',
    });
    expect(roomsService.setChimeMeetingId).toHaveBeenCalledWith('room-1', 'meeting-123');
  });

  it('reusa la reunión de Chime existente si la sala ya tiene una activa', async () => {
    roomsService.getByCodeOrThrow.mockResolvedValue(
      buildRoom({ chimeMeetingId: 'meeting-existente' }),
    );
    const existingMeeting = { MeetingId: 'meeting-existente', ExternalMeetingId: 'ABC123' };
    send.mockResolvedValue({ Meeting: existingMeeting });

    const meeting = await service.createMeetingForRoom('ABC123');

    expect(meeting).toEqual(existingMeeting);
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as GetMeetingCommand;
    expect(command).toBeInstanceOf(GetMeetingCommand);
    expect(command.input).toMatchObject({ MeetingId: 'meeting-existente' });
    expect(roomsService.setChimeMeetingId).not.toHaveBeenCalled();
  });

  it('crea una reunión nueva si la que tenía guardada la sala ya no existe en Chime', async () => {
    roomsService.getByCodeOrThrow.mockResolvedValue(
      buildRoom({ chimeMeetingId: 'meeting-vencida' }),
    );
    const newMeeting = { MeetingId: 'meeting-nueva', ExternalMeetingId: 'ABC123' };
    send
      .mockRejectedValueOnce(new NotFoundException({ message: 'not found', $metadata: {} }))
      .mockResolvedValueOnce({ Meeting: newMeeting });

    const meeting = await service.createMeetingForRoom('ABC123');

    expect(meeting).toEqual(newMeeting);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetMeetingCommand);
    expect(send.mock.calls[1][0]).toBeInstanceOf(CreateMeetingCommand);
    expect(roomsService.setChimeMeetingId).toHaveBeenCalledWith('room-1', 'meeting-nueva');
  });

  it('crea un asistente de Chime para un usuario dentro de una reunión', async () => {
    const fakeAttendee = { AttendeeId: 'attendee-123', ExternalUserId: 'user-456' };
    send.mockResolvedValue({ Attendee: fakeAttendee });

    const attendee = await service.createAttendee('meeting-123', 'user-456');

    expect(attendee).toEqual(fakeAttendee);
    expect(send).toHaveBeenCalledTimes(1);

    const command = send.mock.calls[0][0] as CreateAttendeeCommand;
    expect(command).toBeInstanceOf(CreateAttendeeCommand);
    expect(command.input).toMatchObject({
      MeetingId: 'meeting-123',
      ExternalUserId: 'user-456',
    });
  });
});
