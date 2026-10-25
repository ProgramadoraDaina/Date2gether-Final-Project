import { describe, expect, it, jest } from '@jest/globals';
import type { CallSession } from './calls';

// Mock explícito, registrado antes de cualquier import dinámico: el barrel de
// amazon-chime-sdk-js también exporta DefaultMessagingSession, que arrastra un
// paquete de @aws-sdk en ESM puro que Jest no puede transformar a CJS. No usamos
// messaging, así que evitamos cargar el módulo real por completo.
//
// Nota: next/jest (basado en SWC) no hace el hoist de jest.mock() por encima de
// imports estáticos como sí hace babel-plugin-jest-hoist. Por eso tanto el módulo
// real como `./chime` se cargan con import() dinámico dentro del test, después
// de que el mock ya quedó registrado.
jest.mock('amazon-chime-sdk-js', () => ({
  ConsoleLogger: jest.fn(),
  DefaultDeviceController: jest.fn(),
  DefaultMeetingSession: jest.fn(),
  MeetingSessionConfiguration: jest.fn(),
  LogLevel: { WARN: 'warn' },
}));

describe('createMeetingSession', () => {
  it('construye la MeetingSessionConfiguration con la reunión y el asistente, y arranca la sesión de Chime', async () => {
    const {
      ConsoleLogger,
      DefaultDeviceController,
      DefaultMeetingSession,
      MeetingSessionConfiguration,
    } = await import('amazon-chime-sdk-js');
    const { createMeetingSession } = await import('./chime');

    const session: CallSession = {
      meeting: { MeetingId: 'meeting-123' },
      attendee: { AttendeeId: 'attendee-456', ExternalUserId: 'user-789' },
    };
    const fakeMeetingSession = { id: 'fake-meeting-session' };
    (DefaultMeetingSession as jest.Mock).mockReturnValue(fakeMeetingSession);

    const meetingSession = createMeetingSession(session);

    expect(MeetingSessionConfiguration).toHaveBeenCalledWith(session.meeting, session.attendee);
    expect(ConsoleLogger).toHaveBeenCalledTimes(1);
    expect(DefaultDeviceController).toHaveBeenCalledTimes(1);
    expect(DefaultMeetingSession).toHaveBeenCalledTimes(1);
    expect(meetingSession).toBe(fakeMeetingSession);
  });
});
