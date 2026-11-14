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
// Mutable (no un objeto fijo): algunos tests necesitan simular que quien
// mira es admin de la sala para verificar que ese rol llega a MeetingRoom.
const mockRoomMembersState = {
  members: [] as unknown[],
  isCurrentUserAdmin: false,
  error: null as string | null,
  changeRole: jest.fn(),
  refetchMembers: jest.fn(),
};
jest.mock('@/features/rooms/useRoomMembers', () => ({
  useRoomMembers: () => mockRoomMembersState,
}));
jest.mock('@/lib/api', () => ({
  requestRoomAccess: jest.fn(),
  getRoomAdmission: jest.fn<() => Promise<unknown>>().mockResolvedValue({
    waitingRoomEnabled: false,
    entryLocked: false,
    requests: [],
  }),
  ApiError: class extends Error {},
}));
jest.mock('@/lib/socket', () => ({ createRoomSocket: jest.fn() }));
// MeetingRoom (LiveKit real) tiene su propia suite dedicada
// (MeetingRoom.spec.tsx) con todos los mocks de @livekit/*; acá solo
// interesa si RoomPage lo monta o no según haya `session`, y con qué props
// (el socket de la sala y el rol de quien mira), no su interior.
const mockMeetingRoom = jest.fn((_props: unknown) => <div>Video de la llamada</div>);
jest.mock('@/features/calls/MeetingRoom', () => ({
  __esModule: true,
  default: (props: unknown) => mockMeetingRoom(props),
}));
// AmbientMusicPlayer (IFrame API de YouTube) tiene su propia suite dedicada
// (AmbientMusicPlayer.spec.tsx); acá solo interesa si RoomPage lo monta en
// la sidebar con el socket de la sala y el rol de quien mira, no su interior.
const mockAmbientMusicPlayer = jest.fn((_props: unknown) => <div>Música ambiental</div>);
jest.mock('@/features/calls/AmbientMusicPlayer', () => ({
  AmbientMusicPlayer: (props: unknown) => mockAmbientMusicPlayer(props),
}));
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
let mockStatus: 'idle' | 'connecting' | 'in-call' | 'error' | 'ended' = 'in-call';
let mockError: string | null = null;
// null hasta que el "backend" devuelva credenciales (igual que
// useCallSession real): MeetingRoom solo se monta cuando session existe,
// sin importar status — por eso los tests de la transición de carga lo
// setean a mano junto con mockStatus.
let mockSession: { url: string; token: string; roomName: string; participantLimit: number } | null =
  null;
const mockEndedByHost = jest.fn();
jest.mock('@/features/calls/useCallSession', () => ({
  useCallSession: () => ({
    status: mockStatus,
    error: mockError,
    endReason: mockStatus === 'ended' ? 'host-left' : null,
    session: mockSession,
    joinCall: mockJoinCall,
    leaveCall: mockLeaveCall,
    connected: jest.fn(),
    failed: jest.fn(),
    endedByHost: mockEndedByHost,
  }),
}));

describe('RoomPage: enlace de invitado', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockStatus = 'in-call';
    mockError = null;
    mockRoomMembersState.isCurrentUserAdmin = false;
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
  it('le pasa a la música ambiental de la sidebar el socket de la sala y si quien mira es administrador', async () => {
    mockRoomMembersState.isCurrentUserAdmin = true;
    mockSession = {
      url: 'wss://media.example.test',
      token: 'token',
      roomName: 'abc-defg-hij',
      participantLimit: 6,
    };
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const fake = {
      on: jest.fn(),
      connect: jest.fn(),
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

    expect(mockAmbientMusicPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ socket: fake, isAdmin: true }),
    );
  });
});

describe('RoomPage: transición de carga antes de entrar a la llamada', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockError = null;
    mockSession = null;
    mockRoomMembersState.isCurrentUserAdmin = false;
  });

  it('mientras la llamada conecta (todavía sin session), el chat ya es usable y el video muestra "Cargando llamada…"', async () => {
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

    // El panel de "Cargando llamada…" ocupa el lugar del video nomás; no
    // bloquea el resto de la sala (antes era un overlay de pantalla
    // completa que tapaba todo, incluido el chat).
    expect(screen.getByText('Cargando llamada…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tu nombre en la reunión')).not.toBeInTheDocument();
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

  it('cuando el anfitrión se desconecta y LiveKit fuerza el cierre, muestra el panel terminal con link a la línea de tiempo y botón para volver a la sala (D5, design.md)', async () => {
    mockStatus = 'ended';
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
      screen.getByText('La llamada terminó porque el anfitrión se desconectó.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver línea de tiempo' })).toHaveAttribute(
      'href',
      '/history',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Volver a la sala' }));
    expect(
      screen.queryByText('La llamada terminó porque el anfitrión se desconectó.'),
    ).not.toBeInTheDocument();
    // El chat sigue disponible sin cambios, aun con la llamada terminada.
    expect(screen.getByPlaceholderText('Escribí un mensaje...')).toBeInTheDocument();
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

    // Simula que el backend ya devolvió credenciales y LiveKit confirmó la
    // conexión (useCallSession pasaría a 'in-call' con session seteada); un
    // evento de socket cualquiera fuerza el re-render que hace que RoomPage
    // lea los valores actualizados.
    mockStatus = 'in-call';
    mockSession = { url: 'wss://media.example.test', token: 'token', roomName: 'abc-defg-hij', participantLimit: 6 };
    callbacks.newMessage?.({
      id: 'm1',
      authorName: 'Otra persona',
      content: 'hola',
      createdAt: new Date().toISOString(),
    });

    await screen.findByPlaceholderText('Escribí un mensaje...');
    expect(screen.queryByText('Cargando llamada…')).not.toBeInTheDocument();
    // next/dynamic (ssr:false) resuelve el chunk de forma asíncrona incluso
    // con el módulo mockeado: hace falta esperarlo, un getByText síncrono
    // llega demasiado pronto.
    await screen.findByText('Video de la llamada');
  });
});
