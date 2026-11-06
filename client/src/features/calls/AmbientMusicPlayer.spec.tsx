import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLanguageStore } from '../translation/store';
import type { MusicState } from './ambientMusic';

function fakeSocket() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, (...args: any[]) => void> = {};
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on: jest.fn((event: string, cb: (...args: any[]) => void) => {
      handlers[event] = cb;
    }),
    off: jest.fn(),
    emit: jest.fn(),
    handlers,
  };
}

interface FakePlayerInstance {
  loadVideoById: jest.Mock;
  cueVideoById: jest.Mock;
  playVideo: jest.Mock;
  pauseVideo: jest.Mock;
  seekTo: jest.Mock;
  getCurrentTime: jest.Mock;
  mute: jest.Mock;
  unMute: jest.Mock;
  destroy: jest.Mock;
}

function fakePlayerInstance(overrides: Partial<FakePlayerInstance> = {}): FakePlayerInstance {
  return {
    loadVideoById: jest.fn(),
    cueVideoById: jest.fn(),
    playVideo: jest.fn(),
    pauseVideo: jest.fn(),
    seekTo: jest.fn(),
    getCurrentTime: jest.fn(() => 0),
    mute: jest.fn(),
    unMute: jest.fn(),
    destroy: jest.fn(),
    ...overrides,
  };
}

function musicState(overrides: Partial<MusicState> = {}): MusicState {
  return {
    videoId: 'dQw4w9WgXcQ',
    isPlaying: false,
    positionSeconds: 10,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('AmbientMusicPlayer', () => {
  let playerInstance: FakePlayerInstance;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let playerCtor: jest.Mock<(...args: any[]) => FakePlayerInstance>;
  let capturedOptions: { events?: { onReady?: () => void; onError?: (e: { data: number }) => void } };

  beforeEach(() => {
    useLanguageStore.setState({ language: 'es' });
    playerInstance = fakePlayerInstance();
    capturedOptions = {};
    playerCtor = jest.fn((_id: unknown, options: typeof capturedOptions) => {
      capturedOptions = options;
      return playerInstance;
    });
    window.YT = { Player: playerCtor } as unknown as typeof YT;
  });

  it('solo el administrador ve los controles para elegir canción y reproducir/pausar', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    render(<AmbientMusicPlayer socket={fakeSocket() as never} isAdmin={false} />);

    expect(screen.queryByPlaceholderText('Pegá un link o ID de YouTube')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reproducir' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unirme a la música' })).toBeInTheDocument();
  });

  it('el admin manda musicSetTrack con el link/id ingresado y limpia el input', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);

    const input = screen.getByPlaceholderText('Pegá un link o ID de YouTube');
    fireEvent.change(input, { target: { value: ' dQw4w9WgXcQ ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Elegir canción' }));

    expect(socket.emit).toHaveBeenCalledWith('musicSetTrack', { videoId: 'dQw4w9WgXcQ' });
    expect(input).toHaveValue('');
  });

  it('reproducir/pausar están deshabilitados sin canción elegida y emiten musicPlay/musicPause una vez que hay una', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);

    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeDisabled();

    act(() => socket.handlers.musicState(musicState({ positionSeconds: 7 })));

    const playButton = screen.getByRole('button', { name: 'Reproducir' });
    expect(playButton).not.toBeDisabled();
    fireEvent.click(playButton);
    expect(socket.emit).toHaveBeenCalledWith('musicPlay', { positionSeconds: 7 });

    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    expect(socket.emit).toHaveBeenCalledWith('musicPause', { positionSeconds: 7 });
  });

  it('al unirse crea el player de YouTube y reconcilia contra el estado ya recibido (pendiente antes de unirse)', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin={false} />);

    // Llega un musicState antes de que el usuario toque "Unirme a la música".
    act(() => socket.handlers.musicState(musicState({ isPlaying: true, positionSeconds: 5 })));
    expect(playerCtor).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Unirme a la música' }));
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());
    act(() => capturedOptions.events?.onReady?.());

    expect(playerCtor).toHaveBeenCalledTimes(1);
    // El tiempo real transcurrido mientras waitFor sondea se suma al cálculo
    // de la posición objetivo (ver reconcilePlayerState); un margen chico
    // evita que el test sea frágil por ese retraso real de unos ms.
    const [, position] = playerInstance.loadVideoById.mock.calls[0];
    expect(playerInstance.loadVideoById).toHaveBeenCalledWith('dQw4w9WgXcQ', expect.anything());
    expect(position).toBeGreaterThanOrEqual(5);
    expect(position).toBeLessThan(5.5);
  });

  it('reconcilia el player ya creado cuando llega un musicState nuevo', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Unirme a la música' }));
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());
    act(() => capturedOptions.events?.onReady?.());
    playerCtor.mockClear();

    act(() => socket.handlers.musicState(musicState({ isPlaying: false, positionSeconds: 20 })));

    expect(playerInstance.cueVideoById).toHaveBeenCalledWith('dQw4w9WgXcQ', 20);
  });

  it('muestra un error que llega por el socket (por ejemplo, link inválido)', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);

    act(() => socket.handlers.error({ message: 'El link o ID de YouTube no es válido' }));

    expect(screen.getByRole('alert')).toHaveTextContent('El link o ID de YouTube no es válido');
  });

  it('un error de reproducción de YouTube (video no disponible) se muestra con un mensaje claro', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Unirme a la música' }));
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onError?.({ data: 101 }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'No se pudo reproducir ese video. Probá con otro link.',
    );
  });

  it('al desmontar, destruye el player y deja de escuchar al socket', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    const { unmount } = render(<AmbientMusicPlayer socket={socket as never} isAdmin={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Unirme a la música' }));
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());
    act(() => capturedOptions.events?.onReady?.());

    unmount();

    expect(playerInstance.destroy).toHaveBeenCalled();
    expect(socket.off).toHaveBeenCalledWith('musicState', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
