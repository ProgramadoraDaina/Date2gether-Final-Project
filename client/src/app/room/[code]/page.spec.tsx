import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
jest.mock('next/navigation', () => ({
  useParams: () => ({ code: 'abc-defg-hij' }),
  usePathname: () => '/room/abc-defg-hij',
}));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/features/rooms/useRoomMembers', () => {
  const state = {
    members: [],
    isCurrentUserAdmin: false,
    error: null,
    changeRole: jest.fn(),
    refetchMembers: jest.fn(),
  };
  return { useRoomMembers: () => state };
});
jest.mock('@/lib/api', () => ({ requestRoomAccess: jest.fn(), ApiError: class extends Error {} }));
jest.mock('@/lib/socket', () => ({ createRoomSocket: jest.fn() }));
// joinCall/leaveCall se comparten entre renders (en vez de jest.fn() nuevos
// dentro del factory) para poder verificar que el auto-join se dispara una
// sola vez, apenas existe `access`, sin click manual.
const mockJoinCall = jest.fn();
const mockLeaveCall = jest.fn();
// mockStatus/mockError son mutables (no un useState real): el mock no es
// reactivo por sí mismo, así que un test que cambia mockStatus a mitad de
// camino necesita forzar un re-render aparte (ver los tests de la pantalla
// de carga) para que el próximo render de RoomPage lea el valor nuevo.
// Default 'in-call' porque la mayoría de los tests existentes ejercitan la
// sala ya conectada (chat, sidebar), no la transición de carga en sí.
let mockStatus: 'idle' | 'connecting' | 'in-call' | 'error' = 'in-call';
let mockError: string | null = null;
jest.mock('@/features/calls/useCallSession', () => ({
  useCallSession: () => ({
    status: mockStatus,
    error: mockError,
    session: null,
    joinCall: mockJoinCall,
    leaveCall: mockLeaveCall,
  }),
}));

describe('RoomPage: enlace de invitado', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockStatus = 'in-call';
    mockError = null;
  });
  it('solicita el nombre y no conecta automáticamente al abrir el enlace', async () => {
    const { createRoomSocket } = await import('@/lib/socket');
    const Page = (await import('./page')).default;
    render(<Page />);
    expect(screen.getByLabelText('Tu nombre en la reunión')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Entrar a la reunión' })).toBeDisabled();
    expect(createRoomSocket).not.toHaveBeenCalled();
    expect(mockJoinCall).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: '   ' },
    });
    expect(screen.getByRole('button', { name: 'Entrar a la reunión' })).toBeDisabled();
  });
  it('se une a la llamada automáticamente después de confirmar un nombre sin cuenta, sin botón manual', async () => {
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      removeAllListeners: jest.fn(),
    };
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue(fake as never);
    const Page = (await import('./page')).default;
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: ' Alex ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(createRoomSocket).toHaveBeenCalledWith('guest-token'));
    expect(requestRoomAccess).toHaveBeenCalledWith('abc-defg-hij', 'Alex');
    expect(fake.emit).toHaveBeenCalledWith('joinRoom', { code: 'abc-defg-hij' });
    await waitFor(() =>
      expect(mockJoinCall).toHaveBeenCalledWith('abc-defg-hij', 'guest-token'),
    );
    expect(screen.queryByRole('button', { name: 'Llamar' })).not.toBeInTheDocument();
  });
  it('no vuelve a unirse a la llamada tras colgar ni ante otros re-renders', async () => {
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      removeAllListeners: jest.fn(),
    };
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue(fake as never);
    const Page = (await import('./page')).default;
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(mockJoinCall).toHaveBeenCalledTimes(1));

    // Simula el hangup: el hook real pondría status/session en 'idle'/null,
    // pero `access`/`code` (las únicas deps del efecto de auto-join) no
    // cambian, así que no debe disparar un segundo joinCall.
    mockLeaveCall();

    // Fuerza un re-render ajeno (un mensaje de chat entrante) para confirmar
    // que el efecto no se reevalúa igual por cualquier cambio de estado.
    callbacks.newMessage?.({
      id: 'm1',
      authorName: 'Otra persona',
      content: 'hola',
      createdAt: new Date().toISOString(),
    });
    await screen.findByText('hola');

    expect(mockJoinCall).toHaveBeenCalledTimes(1);
  });
  it('el botón de toggle oculta y vuelve a mostrar el panel de chat', async () => {
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      removeAllListeners: jest.fn(),
    };
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue(fake as never);
    const Page = (await import('./page')).default;
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(mockJoinCall).toHaveBeenCalledTimes(1));

    // Por defecto el chat está visible.
    expect(screen.getByPlaceholderText('Escribí un mensaje...')).toBeVisible();
    const toggle = screen.getByRole('button', { name: 'Ocultar chat' });

    fireEvent.click(toggle);
    expect(screen.queryByPlaceholderText('Escribí un mensaje...')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar chat' }));
    expect(screen.getByPlaceholderText('Escribí un mensaje...')).toBeVisible();
  });
  it('el botón de toggle colapsa y vuelve a expandir el panel lateral', async () => {
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      removeAllListeners: jest.fn(),
    };
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue(fake as never);
    const Page = (await import('./page')).default;
    const { container } = render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(mockJoinCall).toHaveBeenCalledTimes(1));

    const wrap = container.querySelector('[data-open]');
    expect(wrap).toHaveAttribute('data-open', 'true');
    const toggle = screen.getByRole('button', { name: 'Ocultar panel lateral' });

    fireEvent.click(toggle);
    expect(wrap).toHaveAttribute('data-open', 'false');
    expect(screen.getByRole('button', { name: 'Mostrar panel lateral' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar panel lateral' }));
    expect(wrap).toHaveAttribute('data-open', 'true');
  });
});

describe('RoomPage: transición de carga antes de entrar a la llamada', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockError = null;
  });

  it('mientras la llamada conecta, muestra un overlay de carga con la tarjeta de nombre encima de la sala (que ya se está armando detrás)', async () => {
    mockStatus = 'connecting';
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue({
      on: jest.fn(),
      connect: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      removeAllListeners: jest.fn(),
    } as never);
    const Page = (await import('./page')).default;
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(mockJoinCall).toHaveBeenCalledTimes(1));

    expect(screen.getByText('Cargando llamada…')).toBeInTheDocument();
    // La tarjeta de nombre se muestra en el overlay (sigue en el DOM).
    expect(screen.getByLabelText('Tu nombre en la reunión')).toBeInTheDocument();
    // La sala de atrás (con el chat) ya está montada para que LiveKit pueda
    // conectar en segundo plano: solo queda tapada visualmente por el
    // overlay (algo que jsdom no modela), no ausente del DOM.
    expect(screen.getByPlaceholderText('Escribí un mensaje...')).toBeInTheDocument();
  });

  it('si falla la conexión, muestra el error y permite reintentar con el mismo código y token', async () => {
    mockStatus = 'error';
    mockError = 'No se pudo conectar a la llamada. La sala puede estar llena o sin conexión.';
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue({
      on: jest.fn(),
      connect: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      removeAllListeners: jest.fn(),
    } as never);
    const Page = (await import('./page')).default;
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(mockJoinCall).toHaveBeenCalledTimes(1));

    expect(
      screen.getByText('No se pudo conectar a la llamada. La sala puede estar llena o sin conexión.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(mockJoinCall).toHaveBeenCalledWith('abc-defg-hij', 'guest-token');
  });

  it('una vez que la llamada queda in-call, transiciona a la sala completa', async () => {
    mockStatus = 'connecting';
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      removeAllListeners: jest.fn(),
    };
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue(fake as never);
    const Page = (await import('./page')).default;
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(mockJoinCall).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Cargando llamada…')).toBeInTheDocument();

    // Simula que LiveKit ya confirmó la conexión (useCallSession pasaría a
    // 'in-call'); un evento de socket cualquiera fuerza el re-render que
    // hace que RoomPage lea el mockStatus actualizado.
    mockStatus = 'in-call';
    callbacks.newMessage?.({
      id: 'm1',
      authorName: 'Otra persona',
      content: 'hola',
      createdAt: new Date().toISOString(),
    });

    await screen.findByPlaceholderText('Escribí un mensaje...');
    expect(screen.queryByText('Cargando llamada…')).not.toBeInTheDocument();
  });
});
