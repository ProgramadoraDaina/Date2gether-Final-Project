import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
jest.mock('next/navigation', () => ({
  useParams: () => ({ code: 'abc-defg-hij' }),
  usePathname: () => '/room/abc-defg-hij',
  useRouter: () => ({ push: jest.fn() }),
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
  currentUserRole: undefined as string | undefined,
  error: null as string | null,
  changeRole: jest.fn(),
  refetchMembers: jest.fn(),
};
jest.mock('@/features/rooms/useRoomMembers', () => ({
  useRoomMembers: () => mockRoomMembersState,
}));
jest.mock('@/lib/api', () => ({
  requestRoomAccess: jest.fn(),
  getRoomInfo: jest.fn<() => Promise<unknown>>().mockResolvedValue({ isPermanent: false }),
  getRoomAdmission: jest.fn<() => Promise<unknown>>().mockResolvedValue({
    waitingRoomEnabled: false,
    entryLocked: false,
    requests: [],
  }),
  getRoomEmojis: jest.fn<() => Promise<never[]>>().mockResolvedValue([]),
  getRoomNotes: jest.fn<() => Promise<unknown>>().mockResolvedValue({
    roomId: 'room-1',
    content: '',
    revision: 0,
    updatedAt: '2026-11-04T00:00:00Z',
  }),
  saveRoomNotes: jest.fn(),
  addRoomLink: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
  getRoomLinks: jest.fn<() => Promise<never[]>>().mockResolvedValue([]),
  getNextScheduleOccurrence: jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({ nextOccurrenceAt: null }),
  RoomNotesConflictError: class extends Error {},
  ApiError: class extends Error {},
}));
jest.mock('@/features/chat/ExpressionPicker', () => ({ ExpressionPicker: () => null }));
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
// Decisión 2 (design.md "Señal de motivo de remoción"): mutable, igual que
// mockStatus/mockError -- por defecto 'host-left' (el caso D5 ya cubierto),
// pero los tests de [5.5] lo cambian para probar el mensaje de
// resolveBreakoutEndCopy sin depender de un socket real disparando
// endedForBreakout()/removedByPolicy().
let mockEndReason: 'host-left' | 'breakout-closed' | 'breakout-locked' | null = 'host-left';
const mockEndedByHost = jest.fn();
jest.mock('@/features/calls/useCallSession', () => ({
  useCallSession: () => ({
    status: mockStatus,
    error: mockError,
    endReason: mockStatus === 'ended' ? mockEndReason : null,
    session: mockSession,
    joinCall: mockJoinCall,
    leaveCall: mockLeaveCall,
    connected: jest.fn(),
    failed: jest.fn(),
    endedByHost: mockEndedByHost,
    endedForBreakout: jest.fn(),
    removedByPolicy: jest.fn(),
  }),
}));

describe('RoomPage: enlace de invitado', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockStatus = 'in-call';
    mockError = null;
    mockEndReason = 'host-left';
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
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
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
    await waitFor(() => expect(mockJoinCall).toHaveBeenCalledWith('abc-defg-hij', 'guest-token'));
    expect(screen.queryByRole('button', { name: 'Llamar' })).not.toBeInTheDocument();
  });
  it('no vuelve a unirse a la llamada tras colgar ni ante otros re-renders', async () => {
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
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
    act(() =>
      callbacks.newMessage?.({
        id: 'm1',
        authorName: 'Otra persona',
        content: 'hola',
        createdAt: new Date().toISOString(),
      }),
    );
    await screen.findByText('hola');

    expect(mockJoinCall).toHaveBeenCalledTimes(1);
  });
  it('el botón de toggle oculta y vuelve a mostrar el panel de chat', async () => {
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
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
  it('si el backend avisa que la sala se borró, reemplaza la sala por un aviso con salida a "Mis salas"', async () => {
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
    };
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue(fake as never);
    const Page = (await import('./page')).default;
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(callbacks.roomDeleted).toBeDefined());

    act(() => callbacks.roomDeleted());

    expect(screen.getByRole('alert')).toHaveTextContent('Esta sala fue eliminada por su administrador.');
    expect(screen.getByRole('link', { name: 'Ir a mis salas' })).toHaveAttribute('href', '/rooms');
    expect(screen.queryByPlaceholderText('Escribí un mensaje...')).not.toBeInTheDocument();
  });

  it('el botón de toggle colapsa y vuelve a expandir el panel lateral', async () => {
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
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
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const fake = {
      on: jest.fn(),
      connect: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
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

  // Decisión 5 (design.md "Frontend: un punto de montaje...", tasks.md
  // 5.6): mismo patrón que PollPanel (page.tsx:951) -- BreakoutView
  // necesita la identity propia para filtrar su fila del selector genérico
  // de traslado y habilitar el auto-traslado explícito.
  it('[5.6] le pasa a MeetingRoom currentParticipantId con el sub del propio participante', async () => {
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
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const fake = {
      on: jest.fn(),
      connect: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
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

    expect(mockMeetingRoom).toHaveBeenCalledWith(
      expect.objectContaining({ currentParticipantId: 'guest-1' }),
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

  it('mientras la llamada conecta (todavía no llegó a in-call), tapa toda la sala con una pantalla de carga completa', async () => {
    mockStatus = 'connecting';
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue({
      on: jest.fn(),
      connect: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
    } as never);
    const Page = (await import('./page')).default;
    const { container } = render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(mockJoinCall).toHaveBeenCalledTimes(1));

    // Hasta que la llamada llegue a 'in-call' por primera vez, la sala
    // completa (sidebar, chat) queda tapada por .enteringScreen: antes el
    // chat quedaba usable desde este momento, pero ahora la transición debe
    // verse como una sola carga continua hasta que todo esté listo.
    expect(screen.getByText('Cargando llamada…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tu nombre en la reunión')).not.toBeInTheDocument();
    expect(container.querySelector('.enteringScreen')).not.toBeNull();
  });

  it('si falla la conexión, muestra el error y permite reintentar con el mismo código y token', async () => {
    mockStatus = 'error';
    mockError = 'No se pudo conectar a la llamada. La sala puede estar llena o sin conexión.';
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue({
      on: jest.fn(),
      connect: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
    } as never);
    const Page = (await import('./page')).default;
    const { container } = render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(mockJoinCall).toHaveBeenCalledTimes(1));

    expect(
      screen.getByText(
        'No se pudo conectar a la llamada. La sala puede estar llena o sin conexión.',
      ),
    ).toBeInTheDocument();

    // Si la llamada nunca llega a conectar, el overlay de entrada no debe
    // quedar tapando el resto de la sala para siempre: el chat y el resto de
    // la sala tienen que seguir usables aunque la llamada haya fallado.
    expect(container.querySelector('.enteringScreen')).toBeNull();
    expect(screen.getByRole('button', { name: 'Presentes' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(mockJoinCall).toHaveBeenCalledWith('abc-defg-hij', 'guest-token');
  });

  it('cuando el anfitrión se desconecta y LiveKit fuerza el cierre, muestra el panel terminal con link a la línea de tiempo y botón para volver a la sala (D5, design.md)', async () => {
    // 'ended' solo puede pasar después de haber estado 'in-call' (ver D5):
    // simula esa secuencia real en vez de arrancar directo en 'ended', así
    // la pantalla de carga completa (que solo tapa la entrada inicial) ya
    // quedó atrás y este panel se prueba donde realmente vive, dentro de la
    // sala ya revelada.
    mockStatus = 'in-call';
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
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
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
    // next/dynamic (ssr:false) resuelve el chunk de forma asíncrona incluso
    // con el módulo mockeado: hace falta esperarlo.
    await screen.findByText('Video de la llamada');

    // El anfitrión se desconecta ahora que ya estábamos adentro.
    mockStatus = 'ended';
    mockSession = null;
    act(() =>
      callbacks.newMessage?.({
        id: 'm1',
        authorName: 'Otra persona',
        content: 'hola',
        createdAt: new Date().toISOString(),
      }),
    );

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

  // Decisión 2 (design.md "Señal de motivo de remoción", tasks.md 5.5):
  // cierra la brecha señalada en apply-progress.md ("Deviations from
  // Design" #1) -- resolveBreakoutEndCopy ya existía pero el panel
  // terminal todavía mostraba el texto fijo de host-left para cualquier
  // endReason. callEndedPanel ahora distingue el motivo real.
  it('[5.5] cuando el admin devuelve a alguien a la fuerza (endedForBreakout), el panel terminal muestra la copia de breakout-closed, no la de host-left', async () => {
    mockStatus = 'in-call';
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
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const fake = {
      on: jest.fn(),
      connect: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
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
    await screen.findByText('Video de la llamada');

    mockStatus = 'ended';
    mockEndReason = 'breakout-closed';
    mockSession = null;
    act(() => {
      fireEvent.change(screen.getByPlaceholderText('Escribí un mensaje...'), {
        target: { value: 'x' },
      });
    });

    expect(screen.getByText('El host te devolvió a la sala principal.')).toBeInTheDocument();
    expect(
      screen.queryByText('La llamada terminó porque el anfitrión se desconectó.'),
    ).not.toBeInTheDocument();
  });

  it('[5.5] cuando a alguien lo expulsan por política locked (removedByPolicy), el panel terminal muestra el mensaje de política, no el de host-left', async () => {
    mockStatus = 'in-call';
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
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const fake = {
      on: jest.fn(),
      connect: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
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
    await screen.findByText('Video de la llamada');

    mockStatus = 'ended';
    mockEndReason = 'breakout-locked';
    mockSession = null;
    act(() => {
      fireEvent.change(screen.getByPlaceholderText('Escribí un mensaje...'), {
        target: { value: 'x' },
      });
    });

    expect(
      screen.getByText('El host te va a devolver a la sala principal.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('La llamada terminó porque el anfitrión se desconectó.'),
    ).not.toBeInTheDocument();
  });

  it('una vez que la llamada queda in-call, transiciona a la sala completa', async () => {
    mockStatus = 'connecting';
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
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
    mockSession = {
      url: 'wss://media.example.test',
      token: 'token',
      roomName: 'abc-defg-hij',
      participantLimit: 6,
    };
    act(() =>
      callbacks.newMessage?.({
        id: 'm1',
        authorName: 'Otra persona',
        content: 'hola',
        createdAt: new Date().toISOString(),
      }),
    );

    await screen.findByPlaceholderText('Escribí un mensaje...');
    expect(screen.queryByText('Cargando llamada…')).not.toBeInTheDocument();
    // next/dynamic (ssr:false) resuelve el chunk de forma asíncrona incluso
    // con el módulo mockeado: hace falta esperarlo, un getByText síncrono
    // llega demasiado pronto.
    await screen.findByText('Video de la llamada');
  });

  it('cuando ya hay credenciales pero LiveKit todavía no confirmó la conexión, monta el video oculto detrás del spinner en vez de mostrarlo a medio conectar', async () => {
    mockStatus = 'connecting';
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue({
      on: jest.fn(),
      connect: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
    } as never);
    const Page = (await import('./page')).default;
    const { container, rerender } = render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(mockJoinCall).toHaveBeenCalledTimes(1));

    // En la app real, startCall (REST) suele resolver bastante antes de que
    // LiveKit confirme la conexión WebRTC: hay una ventana con session ya
    // seteada y status todavía 'connecting'. MeetingRoom necesita estar
    // montado en ese momento (onConnected es lo que dispara 'in-call'), pero
    // no debe verse: antes esto hacía que la pantalla saltara del spinner a
    // la grilla de video todavía conectando.
    mockSession = {
      url: 'wss://media.example.test',
      token: 'token',
      roomName: 'abc-defg-hij',
      participantLimit: 6,
    };
    rerender(<Page />);

    expect(screen.getByText('Cargando llamada…')).toBeInTheDocument();
    await screen.findByText('Video de la llamada');
    expect(container.querySelector('[data-hidden="true"]')).not.toBeNull();

    mockStatus = 'in-call';
    rerender(<Page />);

    expect(screen.queryByText('Cargando llamada…')).not.toBeInTheDocument();
    expect(container.querySelector('[data-hidden="true"]')).toBeNull();
  });
});

describe('RoomPage: notas y menciones', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockStatus = 'in-call';
    mockError = null;
    mockSession = null;
  });

  async function enter() {
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', roomId: 'room-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const socket = {
      on: jest.fn((event: string, callback: (...args: unknown[]) => void) => {
        callbacks[event] = callback;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
    };
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue(socket as never);
    const Page = (await import('./page')).default;
    const view = render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await screen.findByPlaceholderText('Escribí un mensaje...');
    return { callbacks, socket, ...view };
  }

  it('guarda y recupera las notas personales al volver a la sala', async () => {
    const first = await enter();
    fireEvent.click(screen.getByRole('button', { name: /^Notas$/ }));
    fireEvent.change(screen.getByLabelText('Notas personales'), {
      target: { value: 'Pendiente de la reunion' },
    });
    expect(localStorage.getItem('date2gether:notes:abc-defg-hij:guest:alex')).toBe(
      'Pendiente de la reunion',
    );
    first.unmount();
    await enter();
    fireEvent.click(screen.getByRole('button', { name: /^Notas$/ }));
    expect(screen.getByLabelText('Notas personales')).toHaveValue('Pendiente de la reunion');
    fireEvent.click(screen.getByRole('button', { name: 'De la sala' }));
    expect(screen.getByLabelText('Notas compartidas de la sala')).toBeEnabled();
  });

  it('envia una mencion y conserva su resaltado cuando sale el participante', async () => {
    const { callbacks, socket } = await enter();
    act(() => callbacks.roomUsers([{ participantId: 'ana', userName: 'Ana' }]));
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '@an' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('@Ana ');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(socket.emit).toHaveBeenCalledWith('sendMessage', { content: '@Ana' });
    act(() =>
      callbacks.newMessage({
        id: 'm-mention',
        authorName: 'Alex',
        kind: 'text',
        content: 'Hola @Ana!',
        createdAt: new Date().toISOString(),
      }),
    );
    expect(screen.getByTestId('messages').querySelector('mark')).toHaveTextContent('@Ana');
    act(() => callbacks.userLeft({ participantId: 'ana', userName: 'Ana' }));
    expect(screen.getByTestId('messages').querySelector('mark')).toHaveTextContent('@Ana');
    expect(input).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('RoomPage: concesión de permisos', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockStatus = 'in-call';
    mockError = null;
    mockSession = null;
    mockRoomMembersState.members = [
      { userId: 'member-1', name: 'Beto', role: 'participante', isOwner: false },
      { userId: 'admin-1', name: 'Ana', role: 'administrador', isOwner: true },
    ];
    mockRoomMembersState.isCurrentUserAdmin = true;
  });

  afterEach(() => {
    mockRoomMembersState.members = [];
    mockRoomMembersState.isCurrentUserAdmin = false;
  });

  async function enter() {
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'token',
      participant: {
        sub: 'self',
        roomId: 'room-1',
        roomCode: 'abc-defg-hij',
        name: 'Ana',
        userId: 'admin-1',
      },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue({
      on: jest.fn((event: string, callback: (...args: unknown[]) => void) => {
        const previous = callbacks[event];
        callbacks[event] = previous
          ? (...args) => {
              previous(...args);
              callback(...args);
            }
          : callback;
      }),
      connect: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
    } as never);
    const Page = (await import('./page')).default;
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Ana' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(createRoomSocket).toHaveBeenCalled());
    act(() =>
      callbacks.roomUsers([
        { participantId: 'self', userName: 'Ana', userId: 'admin-1' },
        { participantId: 'other', userName: 'Beto', userId: 'member-1' },
        { participantId: 'guest', userName: 'Invitado' },
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Presentes' }));
    return callbacks;
  }

  it('ofrece otorgar colaborador y admin a un participante registrado', async () => {
    await enter();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Permisos de Beto' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hacer colaborador' }));
    expect(mockRoomMembersState.changeRole).toHaveBeenCalledWith('member-1', 'colaborador');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Permisos de Beto' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hacer administrador' }));
    expect(mockRoomMembersState.changeRole).toHaveBeenCalledWith('member-1', 'administrador');
    expect(screen.getAllByTestId('role-button')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('también permite ascender a admin a un colaborador', async () => {
    mockRoomMembersState.members[0] = {
      userId: 'member-1',
      name: 'Beto',
      role: 'colaborador',
      isOwner: false,
    };
    await enter();
    fireEvent.click(screen.getByRole('button', { name: 'Permisos de Beto' }));
    expect(screen.getByRole('menuitem', { name: 'Quitar colaborador' })).toBeVisible();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hacer administrador' }));
    expect(mockRoomMembersState.changeRole).toHaveBeenCalledWith('member-1', 'administrador');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('permite quitar admin desde el menú cuando queda otro administrador', async () => {
    mockRoomMembersState.members[0] = {
      userId: 'member-1',
      name: 'Beto',
      role: 'administrador',
      isOwner: false,
    };
    await enter();
    expect(screen.getByText('Propietario')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Permisos de Ana' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Permisos de Beto' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Quitar administrador' }));
    expect(mockRoomMembersState.changeRole).toHaveBeenCalledWith('member-1', 'participante');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('un colaborador no puede otorgar ninguno de los roles', async () => {
    mockRoomMembersState.isCurrentUserAdmin = false;
    await enter();
    expect(screen.queryByTestId('role-button')).not.toBeInTheDocument();
  });

  it('actualiza los roles cuando entra un participante registrado para poder darle permisos sin recargar', async () => {
    const callbacks = await enter();
    mockRoomMembersState.refetchMembers.mockClear();
    act(() =>
      callbacks.userJoined({ participantId: 'new', userName: 'Nueva', userId: 'user-new' }),
    );
    expect(mockRoomMembersState.refetchMembers).toHaveBeenCalled();
  });
});

describe('RoomPage: biblioteca de links', () => {
  const LINK_MESSAGE = {
    id: 'm-link',
    authorName: 'Santi',
    kind: 'text',
    content: 'Apunte de hoy: https://docs.example.com/clase-1',
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockStatus = 'in-call';
    mockRoomMembersState.currentUserRole = undefined;
  });

  async function enterRoom(isPermanent: boolean) {
    const { requestRoomAccess, getRoomInfo } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    jest.mocked(getRoomInfo).mockResolvedValue({ isPermanent } as never);
    jest.mocked(requestRoomAccess).mockResolvedValue({
      token: 'room-token',
      participant: { sub: 'u-1', roomId: 'room-1', name: 'Gabi', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
    };
    jest.mocked(createRoomSocket).mockReturnValue(fake as never);
    const Page = (await import('./page')).default;
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Gabi' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(createRoomSocket).toHaveBeenCalled());
    await waitFor(() => expect(getRoomInfo).toHaveBeenCalled());
    act(() => callbacks.newMessage?.(LINK_MESSAGE));
    await screen.findByText(/Apunte de hoy/);
  }

  it('en una sala permanente, un colaborador fija el link de un mensaje en la biblioteca', async () => {
    mockRoomMembersState.currentUserRole = 'colaborador';
    const { addRoomLink } = await import('@/lib/api');
    await enterRoom(true);

    fireEvent.click(await screen.findByRole('button', { name: 'Fijar link' }));

    await waitFor(() =>
      expect(addRoomLink).toHaveBeenCalledWith('abc-defg-hij', {
        url: 'https://docs.example.com/clase-1',
        title: 'Apunte de hoy',
      }),
    );
    expect(await screen.findByTestId('notice')).toHaveTextContent('Link fijado en la biblioteca');
    expect(screen.getByRole('button', { name: 'Links' })).toBeInTheDocument();
  });

  it('un participante sin rol ve la pestaña Links pero no puede fijar', async () => {
    mockRoomMembersState.currentUserRole = 'participante';
    await enterRoom(true);

    await screen.findByRole('button', { name: 'Links' });
    expect(screen.queryByRole('button', { name: 'Fijar link' })).not.toBeInTheDocument();
  });

  it('una sala temporal no tiene biblioteca de links', async () => {
    mockRoomMembersState.currentUserRole = 'administrador';
    await enterRoom(false);

    expect(screen.queryByRole('button', { name: 'Links' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fijar link' })).not.toBeInTheDocument();
  });
});
