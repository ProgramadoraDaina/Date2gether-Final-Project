import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BreakoutRoom } from '@/lib/breakouts';
import { useLanguageStore } from '../translation/store';

jest.mock('@/lib/breakouts', () => ({
  createBreakoutRoom: jest.fn(),
  listBreakoutRooms: jest.fn(),
  updateBreakoutRoomPolicy: jest.fn(),
  moveToBreakoutRoom: jest.fn(),
  closeBreakoutRoom: jest.fn(),
  closeAllBreakoutRooms: jest.fn(),
  returnFromBreakoutRoom: jest.fn(),
}));

const roomCode = 'abc-defg-hij';
const roomToken = 'room-token';
const participants = [
  { livekitIdentity: 'guest-sub', displayName: 'Invitado' },
  { livekitIdentity: 'other-sub', displayName: 'Otra persona' },
];

function openBreakout(overrides: Partial<BreakoutRoom> = {}): BreakoutRoom {
  return {
    id: 'breakout-1',
    livekitRoomName: `${roomCode}::breakout-1`,
    label: 'Mini sala 1',
    leavePolicy: 'locked',
    autoCloseAt: null,
    occupants: [],
    ...overrides,
  };
}

describe('BreakoutPanel', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    useLanguageStore.setState({ language: 'es' });
    const { listBreakoutRooms } = await import('@/lib/breakouts');
    (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([]);
  });

  it('muestra el mensaje de "sin mini salas" cuando todavía no hay ninguna', async () => {
    const { BreakoutPanel } = await import('./BreakoutPanel');
    render(<BreakoutPanel roomCode={roomCode} roomToken={roomToken} participants={participants} />);

    await waitFor(() =>
      expect(screen.getByText('Todavía no hay mini salas abiertas.')).toBeInTheDocument(),
    );
  });

  it('al crear, llama createBreakoutRoom con los minutos indicados y refresca el listado', async () => {
    const { createBreakoutRoom, listBreakoutRooms } = await import('@/lib/breakouts');
    (createBreakoutRoom as jest.Mock<typeof createBreakoutRoom>).mockResolvedValue(openBreakout());
    const { BreakoutPanel } = await import('./BreakoutPanel');
    render(<BreakoutPanel roomCode={roomCode} roomToken={roomToken} participants={participants} />);
    await waitFor(() => expect(listBreakoutRooms).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Cierre automático en minutos'), {
      target: { value: '10' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Crear mini sala' }));
    });

    expect(createBreakoutRoom).toHaveBeenCalledWith(roomCode, roomToken, {
      autoCloseInMinutes: 10,
    });
    await waitFor(() => expect(listBreakoutRooms).toHaveBeenCalledTimes(2));
  });

  it('si create() rechaza con el mensaje de tope alcanzado, lo muestra como error', async () => {
    const { createBreakoutRoom } = await import('@/lib/breakouts');
    (createBreakoutRoom as jest.Mock<typeof createBreakoutRoom>).mockRejectedValue(
      new Error('Alcanzaste el máximo de mini salas simultáneas'),
    );
    const { BreakoutPanel } = await import('./BreakoutPanel');
    render(<BreakoutPanel roomCode={roomCode} roomToken={roomToken} participants={participants} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Crear mini sala' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Alcanzaste el máximo de mini salas simultáneas',
    );
  });

  it('el toggle de política llama updatePolicy con la política invertida', async () => {
    const { listBreakoutRooms, updateBreakoutRoomPolicy } = await import('@/lib/breakouts');
    const room = openBreakout({ leavePolicy: 'locked' });
    (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([room]);
    (updateBreakoutRoomPolicy as jest.Mock<typeof updateBreakoutRoomPolicy>).mockResolvedValue({
      ...room,
      leavePolicy: 'free_return',
    });
    const { BreakoutPanel } = await import('./BreakoutPanel');
    render(<BreakoutPanel roomCode={roomCode} roomToken={roomToken} participants={participants} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Permitir volver libremente' })).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Permitir volver libremente' }));
    });

    expect(updateBreakoutRoomPolicy).toHaveBeenCalledWith(roomCode, roomToken, room.id, {
      leavePolicy: 'free_return',
    });
  });

  it('elegir un participante y trasladar llama moveToBreakoutRoom con la identity elegida', async () => {
    const { listBreakoutRooms, moveToBreakoutRoom } = await import('@/lib/breakouts');
    const room = openBreakout();
    (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([room]);
    (moveToBreakoutRoom as jest.Mock<typeof moveToBreakoutRoom>).mockResolvedValue({
      targetIdentity: 'new-identity',
    });
    const { BreakoutPanel } = await import('./BreakoutPanel');
    render(<BreakoutPanel roomCode={roomCode} roomToken={roomToken} participants={participants} />);
    await waitFor(() =>
      expect(screen.getByLabelText('Trasladar a Mini sala 1')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText('Trasladar a Mini sala 1'), {
      target: { value: 'guest-sub' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Trasladar' }));
    });

    expect(moveToBreakoutRoom).toHaveBeenCalledWith(roomCode, roomToken, room.id, 'guest-sub');
  });

  it('el botón "Trasladar" está deshabilitado hasta elegir un participante', async () => {
    const { listBreakoutRooms } = await import('@/lib/breakouts');
    (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([openBreakout()]);
    const { BreakoutPanel } = await import('./BreakoutPanel');
    render(<BreakoutPanel roomCode={roomCode} roomToken={roomToken} participants={participants} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Trasladar' })).toBeDisabled(),
    );
  });

  it('cerrar una mini sala llama closeBreakoutRoom con su id', async () => {
    const { listBreakoutRooms, closeBreakoutRoom } = await import('@/lib/breakouts');
    const room = openBreakout();
    (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([room]);
    const { BreakoutPanel } = await import('./BreakoutPanel');
    render(<BreakoutPanel roomCode={roomCode} roomToken={roomToken} participants={participants} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    });

    expect(closeBreakoutRoom).toHaveBeenCalledWith(roomCode, roomToken, room.id);
  });

  it('"Cerrar todas" llama closeAllBreakoutRooms', async () => {
    const { listBreakoutRooms, closeAllBreakoutRooms } = await import('@/lib/breakouts');
    (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([openBreakout()]);
    const { BreakoutPanel } = await import('./BreakoutPanel');
    render(<BreakoutPanel roomCode={roomCode} roomToken={roomToken} participants={participants} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cerrar todas' })).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar todas' }));
    });

    expect(closeAllBreakoutRooms).toHaveBeenCalledWith(roomCode, roomToken);
  });

  it('"Devolver a todos" llama returnFromBreakoutRoom por cada ocupante de cada mini sala', async () => {
    const { listBreakoutRooms, returnFromBreakoutRoom } = await import('@/lib/breakouts');
    const rooms = [
      openBreakout({
        id: 'b1',
        occupants: [{ livekitIdentity: 'id-1', displayName: 'Uno', userId: null }],
      }),
      openBreakout({
        id: 'b2',
        label: 'Mini sala 2',
        occupants: [{ livekitIdentity: 'id-2', displayName: 'Dos', userId: null }],
      }),
    ];
    (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue(rooms);
    const { BreakoutPanel } = await import('./BreakoutPanel');
    render(<BreakoutPanel roomCode={roomCode} roomToken={roomToken} participants={participants} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Devolver a todos' })).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Devolver a todos' }));
    });

    expect(returnFromBreakoutRoom).toHaveBeenCalledWith(roomCode, roomToken, 'b1', 'id-1');
    expect(returnFromBreakoutRoom).toHaveBeenCalledWith(roomCode, roomToken, 'b2', 'id-2');
  });
});
