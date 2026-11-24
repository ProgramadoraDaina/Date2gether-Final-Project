import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BreakoutRoom, BreakoutRoomAdminView } from '@/lib/breakouts';
import { useLanguageStore } from '../translation/store';

jest.mock('@/lib/breakouts', () => ({
  createBreakoutRoom: jest.fn(),
  listBreakoutRooms: jest.fn(),
  updateBreakoutRoomPolicy: jest.fn(),
  moveToBreakoutRoom: jest.fn(),
  closeBreakoutRoom: jest.fn(),
  closeAllBreakoutRooms: jest.fn(),
  returnFromBreakoutRoom: jest.fn(),
  // Puro -- se reusa la implementación real (Decisión 4, design.md): solo
  // la vista de admin trae `occupants`.
  isAdminBreakoutView: (room: { occupants?: unknown }) => 'occupants' in room,
}));

const roomCode = 'abc-defg-hij';
const roomToken = 'room-token';
const currentParticipantId = 'admin-sub';
// Presencia de socket cruda de la sala principal (page.tsx:breakoutParticipants):
// incluye a TODOS, incluso a quienes ya están en una mini sala y al propio admin.
const participants = [
  { livekitIdentity: 'admin-sub', displayName: 'Admin' },
  { livekitIdentity: 'guest-sub', displayName: 'Invitado' },
  { livekitIdentity: 'other-sub', displayName: 'Otra persona' },
];

function openBreakout(overrides: Partial<BreakoutRoomAdminView> = {}): BreakoutRoomAdminView {
  return {
    id: 'breakout-1',
    livekitRoomName: `${roomCode}::breakout-1`,
    label: 'Mini sala 1',
    leavePolicy: 'locked',
    joinPolicy: 'admin_only',
    autoCloseAt: null,
    occupants: [],
    ...overrides,
  };
}

describe('BreakoutHostConsole', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    useLanguageStore.setState({ language: 'es' });
    const { listBreakoutRooms } = await import('@/lib/breakouts');
    (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([]);
  });

  it('muestra el mensaje de "sin mini salas" cuando todavía no hay ninguna', async () => {
    const { BreakoutHostConsole } = await import('./BreakoutHostConsole');
    render(
      <BreakoutHostConsole
        roomCode={roomCode}
        roomToken={roomToken}
        participants={participants}
        currentParticipantId={currentParticipantId}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText('Todavía no hay mini salas abiertas.')).toBeInTheDocument(),
    );
  });

  it('al crear, llama createBreakoutRoom con los minutos indicados y refresca el listado', async () => {
    const { createBreakoutRoom, listBreakoutRooms } = await import('@/lib/breakouts');
    (createBreakoutRoom as jest.Mock<typeof createBreakoutRoom>).mockResolvedValue(
      openBreakout() as unknown as BreakoutRoom,
    );
    const { BreakoutHostConsole } = await import('./BreakoutHostConsole');
    render(
      <BreakoutHostConsole
        roomCode={roomCode}
        roomToken={roomToken}
        participants={participants}
        currentParticipantId={currentParticipantId}
      />,
    );
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
    const { BreakoutHostConsole } = await import('./BreakoutHostConsole');
    render(
      <BreakoutHostConsole
        roomCode={roomCode}
        roomToken={roomToken}
        participants={participants}
        currentParticipantId={currentParticipantId}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Crear mini sala' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Alcanzaste el máximo de mini salas simultáneas',
    );
  });

  // Decisión 4 (design.md "Proyección de list por rol"): la sala principal
  // se calcula acá como breakoutParticipants MENOS la unión de
  // occupants.sourceIdentity de todas las mini salas (la única resta
  // posible para invitados, imposible solo por userId).
  describe('[5.2] sala principal con ocupantes', () => {
    it('muestra en la principal solo a quienes NO tienen una asignación abierta en ninguna mini sala', async () => {
      const { listBreakoutRooms } = await import('@/lib/breakouts');
      const room = openBreakout({
        occupants: [
          { livekitIdentity: 'mini-1', sourceIdentity: 'guest-sub', displayName: 'Invitado', userId: null },
        ],
      });
      (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([room]);
      const { BreakoutHostConsole } = await import('./BreakoutHostConsole');
      render(
        <BreakoutHostConsole
          roomCode={roomCode}
          roomToken={roomToken}
          participants={participants}
          currentParticipantId={currentParticipantId}
        />,
      );

      // Espera a que termine el fetch asíncrono de rooms (no solo a que la
      // etiqueta "Sala principal" exista -- esa está presente desde el
      // primer render, antes de que la resta por sourceIdentity sea posible).
      await waitFor(() => expect(screen.getByText('Mini sala 1')).toBeInTheDocument());
      const principalPane = screen.getByTestId('breakout-principal-pane');
      expect(within(principalPane).getByText('Admin')).toBeInTheDocument();
      expect(within(principalPane).getByText('Otra persona')).toBeInTheDocument();
      // "Invitado" sigue apareciendo en el roster de su mini sala (correcto):
      // la ausencia que importa es específicamente dentro de la principal.
      expect(within(principalPane).queryByText('Invitado')).toBeNull();
    });
  });

  // Decisión 3 (design.md "joinPolicy"): dos toggles separados, rotulados
  // distinto, cada uno cambia SOLO su propia política.
  describe('[5.2] dos toggles de política (leavePolicy / joinPolicy)', () => {
    it('el toggle de leavePolicy llama updatePolicy solo con leavePolicy invertida', async () => {
      const { listBreakoutRooms, updateBreakoutRoomPolicy } = await import('@/lib/breakouts');
      const room = openBreakout({ leavePolicy: 'locked' });
      (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([room]);
      (updateBreakoutRoomPolicy as jest.Mock<typeof updateBreakoutRoomPolicy>).mockResolvedValue({
        ...room,
        leavePolicy: 'free_return',
      } as unknown as BreakoutRoom);
      const { BreakoutHostConsole } = await import('./BreakoutHostConsole');
      render(
        <BreakoutHostConsole
          roomCode={roomCode}
          roomToken={roomToken}
          participants={participants}
          currentParticipantId={currentParticipantId}
        />,
      );
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

    it('el toggle de joinPolicy llama updatePolicy solo con joinPolicy invertida, nunca con leavePolicy', async () => {
      const { listBreakoutRooms, updateBreakoutRoomPolicy } = await import('@/lib/breakouts');
      const room = openBreakout({ joinPolicy: 'admin_only' });
      (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([room]);
      (updateBreakoutRoomPolicy as jest.Mock<typeof updateBreakoutRoomPolicy>).mockResolvedValue({
        ...room,
        joinPolicy: 'open',
      } as unknown as BreakoutRoom);
      const { BreakoutHostConsole } = await import('./BreakoutHostConsole');
      render(
        <BreakoutHostConsole
          roomCode={roomCode}
          roomToken={roomToken}
          participants={participants}
          currentParticipantId={currentParticipantId}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Permitir auto-ingreso' })).toBeInTheDocument(),
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Permitir auto-ingreso' }));
      });

      expect(updateBreakoutRoomPolicy).toHaveBeenCalledWith(roomCode, roomToken, room.id, {
        joinPolicy: 'open',
      });
      expect(updateBreakoutRoomPolicy).not.toHaveBeenCalledWith(
        roomCode,
        roomToken,
        room.id,
        expect.objectContaining({ leavePolicy: expect.anything() }),
      );
    });
  });

  // Decisión 5 (design.md): el selector de traslado filtra la identidad
  // propia -- nunca aparece como fila del listado genérico -- y el
  // auto-traslado del admin es una acción explícita y separada.
  describe('[5.7] selector de traslado filtra currentParticipantId; auto-traslado es una acción separada', () => {
    it('el selector de traslado nunca incluye la fila del propio admin', async () => {
      const { listBreakoutRooms } = await import('@/lib/breakouts');
      (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([openBreakout()]);
      const { BreakoutHostConsole } = await import('./BreakoutHostConsole');
      render(
        <BreakoutHostConsole
          roomCode={roomCode}
          roomToken={roomToken}
          participants={participants}
          currentParticipantId={currentParticipantId}
        />,
      );

      await waitFor(() =>
        expect(screen.getByLabelText('Trasladar a Mini sala 1')).toBeInTheDocument(),
      );
      const select = screen.getByLabelText('Trasladar a Mini sala 1') as HTMLSelectElement;
      const optionValues = Array.from(select.options).map((option) => option.value);
      expect(optionValues).not.toContain(currentParticipantId);
      expect(optionValues).toContain('guest-sub');
    });

    it('"Trasladarme acá" llama moveToBreakoutRoom con currentParticipantId, sin pasar por el selector', async () => {
      const { listBreakoutRooms, moveToBreakoutRoom } = await import('@/lib/breakouts');
      (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([openBreakout()]);
      (moveToBreakoutRoom as jest.Mock<typeof moveToBreakoutRoom>).mockResolvedValue({
        targetIdentity: 'new-identity',
      });
      const { BreakoutHostConsole } = await import('./BreakoutHostConsole');
      render(
        <BreakoutHostConsole
          roomCode={roomCode}
          roomToken={roomToken}
          participants={participants}
          currentParticipantId={currentParticipantId}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Trasladarme acá' })).toBeInTheDocument(),
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Trasladarme acá' }));
      });

      expect(moveToBreakoutRoom).toHaveBeenCalledWith(
        roomCode,
        roomToken,
        'breakout-1',
        currentParticipantId,
      );
    });
  });

  it('elegir un participante y trasladar llama moveToBreakoutRoom con la identity elegida', async () => {
    const { listBreakoutRooms, moveToBreakoutRoom } = await import('@/lib/breakouts');
    const room = openBreakout();
    (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([room]);
    (moveToBreakoutRoom as jest.Mock<typeof moveToBreakoutRoom>).mockResolvedValue({
      targetIdentity: 'new-identity',
    });
    const { BreakoutHostConsole } = await import('./BreakoutHostConsole');
    render(
      <BreakoutHostConsole
        roomCode={roomCode}
        roomToken={roomToken}
        participants={participants}
        currentParticipantId={currentParticipantId}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Trasladar a Mini sala 1')).toBeInTheDocument());

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
    const { BreakoutHostConsole } = await import('./BreakoutHostConsole');
    render(
      <BreakoutHostConsole
        roomCode={roomCode}
        roomToken={roomToken}
        participants={participants}
        currentParticipantId={currentParticipantId}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Trasladar' })).toBeDisabled());
  });

  it('cerrar una mini sala llama closeBreakoutRoom con su id', async () => {
    const { listBreakoutRooms, closeBreakoutRoom } = await import('@/lib/breakouts');
    const room = openBreakout();
    (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([room]);
    const { BreakoutHostConsole } = await import('./BreakoutHostConsole');
    render(
      <BreakoutHostConsole
        roomCode={roomCode}
        roomToken={roomToken}
        participants={participants}
        currentParticipantId={currentParticipantId}
      />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    });

    expect(closeBreakoutRoom).toHaveBeenCalledWith(roomCode, roomToken, room.id);
  });

  it('"Cerrar todas" llama closeAllBreakoutRooms', async () => {
    const { listBreakoutRooms, closeAllBreakoutRooms } = await import('@/lib/breakouts');
    (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([openBreakout()]);
    const { BreakoutHostConsole } = await import('./BreakoutHostConsole');
    render(
      <BreakoutHostConsole
        roomCode={roomCode}
        roomToken={roomToken}
        participants={participants}
        currentParticipantId={currentParticipantId}
      />,
    );
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
        occupants: [
          { livekitIdentity: 'id-1', sourceIdentity: 'source-1', displayName: 'Uno', userId: null },
        ],
      }),
      openBreakout({
        id: 'b2',
        label: 'Mini sala 2',
        occupants: [
          { livekitIdentity: 'id-2', sourceIdentity: 'source-2', displayName: 'Dos', userId: null },
        ],
      }),
    ];
    (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue(rooms);
    const { BreakoutHostConsole } = await import('./BreakoutHostConsole');
    render(
      <BreakoutHostConsole
        roomCode={roomCode}
        roomToken={roomToken}
        participants={participants}
        currentParticipantId={currentParticipantId}
      />,
    );
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
