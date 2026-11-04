import { describe, expect, it, jest } from '@jest/globals';
import { RoomEventsService } from './room-events.service';

describe('RoomEventsService', () => {
  it('entrega a cada listener registrado el payload exacto del cambio de rol', () => {
    const events = new RoomEventsService();
    const listener = jest.fn();
    events.onMemberRoleChanged(listener);

    events.emitMemberRoleChanged({ roomCode: 'abc-defg-hij' });

    expect(listener).toHaveBeenCalledWith({ roomCode: 'abc-defg-hij' });
  });

  it('no entrega el evento a listeners que todavía no se registraron cuando se emitió', () => {
    const events = new RoomEventsService();
    const listener = jest.fn();

    events.emitMemberRoleChanged({ roomCode: 'abc-defg-hij' });
    events.onMemberRoleChanged(listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifica a varios listeners registrados para el mismo evento', () => {
    const events = new RoomEventsService();
    const first = jest.fn();
    const second = jest.fn();
    events.onMemberRoleChanged(first);
    events.onMemberRoleChanged(second);

    events.emitMemberRoleChanged({ roomCode: 'xyz-abcd-efg' });

    expect(first).toHaveBeenCalledWith({ roomCode: 'xyz-abcd-efg' });
    expect(second).toHaveBeenCalledWith({ roomCode: 'xyz-abcd-efg' });
  });
});
