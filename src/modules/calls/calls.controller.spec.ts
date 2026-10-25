import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';

describe('CallsController', () => {
  let controller: CallsController;
  let callsService: {
    createMeetingForRoom: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    createAttendee: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };

  beforeEach(async () => {
    callsService = {
      createMeetingForRoom: jest.fn(),
      createAttendee: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [CallsController],
      providers: [{ provide: CallsService, useValue: callsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CallsController);
  });

  it('delega la creación de la reunión al CallsService con el código de sala', async () => {
    const fakeMeeting = { MeetingId: 'meeting-123' };
    callsService.createMeetingForRoom.mockResolvedValue(fakeMeeting);

    const result = await controller.createMeeting('ABC123');

    expect(result).toEqual(fakeMeeting);
    expect(callsService.createMeetingForRoom).toHaveBeenCalledWith('ABC123');
  });

  it('delega la creación del asistente al CallsService con el meetingId y el id del usuario autenticado', async () => {
    const fakeAttendee = { AttendeeId: 'attendee-123' };
    callsService.createAttendee.mockResolvedValue(fakeAttendee);
    const user: AccessTokenPayload = { sub: 'user-456', email: 'user@example.com' };

    const result = await controller.createAttendee('meeting-123', user);

    expect(result).toEqual(fakeAttendee);
    expect(callsService.createAttendee).toHaveBeenCalledWith('meeting-123', 'user-456');
  });
});
