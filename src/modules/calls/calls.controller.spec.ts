import { describe, expect, it, jest } from '@jest/globals';
import type { ParticipantRequest } from '../auth/guards/room-access.guard';
import { CallsController } from './calls.controller';
import type { CallsService } from './calls.service';

describe('CallsController', () => {
  it('crea el asistente en la reunión de la sala con la identidad del pase de invitado', async () => {
    const meeting = { MeetingId: 'meeting-123' };
    const attendee = { AttendeeId: 'attendee-456' };
    const service = {
      createMeetingForRoom: jest
        .fn<CallsService['createMeetingForRoom']>()
        .mockResolvedValue(meeting),
      createAttendee: jest.fn<CallsService['createAttendee']>().mockResolvedValue(attendee),
    };
    const controller = new CallsController(service as unknown as CallsService);
    const request = {
      participant: { sub: 'guest-123', roomCode: 'abc-defg-hij', name: 'Alex' },
    } as ParticipantRequest;
    await expect(controller.join('abc-defg-hij', request)).resolves.toEqual({ meeting, attendee });
    expect(service.createAttendee).toHaveBeenCalledWith('meeting-123', 'guest-123');
  });
});
