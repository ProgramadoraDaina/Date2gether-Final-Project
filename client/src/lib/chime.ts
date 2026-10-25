import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  type MeetingSession,
  MeetingSessionConfiguration,
} from 'amazon-chime-sdk-js';
import type { CallSession } from './calls';

export function createMeetingSession(session: CallSession): MeetingSession {
  const configuration = new MeetingSessionConfiguration(session.meeting, session.attendee);
  const logger = new ConsoleLogger('Date2gether', LogLevel.WARN);
  const deviceController = new DefaultDeviceController(logger);

  return new DefaultMeetingSession(configuration, logger, deviceController);
}
