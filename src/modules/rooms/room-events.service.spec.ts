import { describe, expect, it, vi } from 'vitest';
import { RoomEventsService } from './room-events.service';

describe('RoomEventsService', () => {
  it('entrega a cada listener registrado el payload exacto del cambio de rol', () => {
    const events = new RoomEventsService();
    const listener = vi.fn();
    events.onMemberRoleChanged(listener);

    events.emitMemberRoleChanged({ roomCode: 'abc-defg-hij' });

    expect(listener).toHaveBeenCalledWith({ roomCode: 'abc-defg-hij' });
  });

  it('no entrega el evento a listeners que todavía no se registraron cuando se emitió', () => {
    const events = new RoomEventsService();
    const listener = vi.fn();

    events.emitMemberRoleChanged({ roomCode: 'abc-defg-hij' });
    events.onMemberRoleChanged(listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifica a varios listeners registrados para el mismo evento', () => {
    const events = new RoomEventsService();
    const first = vi.fn();
    const second = vi.fn();
    events.onMemberRoleChanged(first);
    events.onMemberRoleChanged(second);

    events.emitMemberRoleChanged({ roomCode: 'xyz-abcd-efg' });

    expect(first).toHaveBeenCalledWith({ roomCode: 'xyz-abcd-efg' });
    expect(second).toHaveBeenCalledWith({ roomCode: 'xyz-abcd-efg' });
  });

  // Mini salas (D12, design.md breakout-rooms): mismo puente, canal propio.
  it('entrega a cada listener registrado el payload exacto de un traslado a mini sala', () => {
    const events = new RoomEventsService();
    const listener = vi.fn();
    events.onBreakoutAssigned(listener);

    events.emitBreakoutAssigned({
      roomCode: 'abc-defg-hij',
      targetIdentity: 'participant-sub-1',
      breakoutId: 'breakout-1',
      label: 'Mini sala 1',
      leavePolicy: 'locked',
    });

    expect(listener).toHaveBeenCalledWith({
      roomCode: 'abc-defg-hij',
      targetIdentity: 'participant-sub-1',
      breakoutId: 'breakout-1',
      label: 'Mini sala 1',
      leavePolicy: 'locked',
    });
  });

  it('entrega a cada listener registrado el payload exacto del cierre de una mini sala', () => {
    const events = new RoomEventsService();
    const listener = vi.fn();
    events.onBreakoutClosed(listener);

    events.emitBreakoutClosed({ roomCode: 'abc-defg-hij', breakoutId: 'breakout-1' });

    expect(listener).toHaveBeenCalledWith({ roomCode: 'abc-defg-hij', breakoutId: 'breakout-1' });
  });
});
