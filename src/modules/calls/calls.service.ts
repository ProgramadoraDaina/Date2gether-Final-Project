import { Injectable } from '@nestjs/common';
import {
  type Attendee,
  ChimeSDKMeetingsClient,
  CreateAttendeeCommand,
  CreateMeetingCommand,
  GetMeetingCommand,
  type Meeting,
  NotFoundException,
} from '@aws-sdk/client-chime-sdk-meetings';
import { randomUUID } from 'node:crypto';
import { RoomsService } from '../rooms/rooms.service';

@Injectable()
export class CallsService {
  constructor(
    private readonly chimeClient: ChimeSDKMeetingsClient,
    private readonly roomsService: RoomsService,
  ) {}

  async createMeetingForRoom(roomCode: string): Promise<Meeting> {
    const room = await this.roomsService.getByCodeOrThrow(roomCode);

    if (room.chimeMeetingId) {
      const existingMeeting = await this.findActiveMeeting(room.chimeMeetingId);
      if (existingMeeting) return existingMeeting;
    }

    const command = new CreateMeetingCommand({
      ClientRequestToken: randomUUID(),
      ExternalMeetingId: roomCode,
      // São Paulo: región de media más cercana a Argentina, menor latencia para el audio/video.
      MediaRegion: 'sa-east-1',
    });

    const response = await this.chimeClient.send(command);
    const meeting = response.Meeting as Meeting;
    await this.roomsService.setChimeMeetingId(room.id, meeting.MeetingId as string);
    return meeting;
  }

  // Devuelve la reunión si Chime todavía la tiene activa, o `undefined` si ya
  // terminó (Chime la da de baja sola tras un tiempo sin asistentes) — en ese
  // caso createMeetingForRoom crea una nueva y la persiste.
  private async findActiveMeeting(meetingId: string): Promise<Meeting | undefined> {
    try {
      const response = await this.chimeClient.send(new GetMeetingCommand({ MeetingId: meetingId }));
      return response.Meeting;
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }

  async createAttendee(meetingId: string, userId: string): Promise<Attendee> {
    const command = new CreateAttendeeCommand({
      MeetingId: meetingId,
      ExternalUserId: userId,
    });

    const response = await this.chimeClient.send(command);
    return response.Attendee as Attendee;
  }
}
