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
  getDuration: jest.Mock;
  mute: jest.Mock;
  unMute: jest.Mock;
  setVolume: jest.Mock;
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
    getDuration: jest.fn(() => 0),
    mute: jest.fn(),
    unMute: jest.fn(),
    setVolume: jest.fn(),
    destroy: jest.fn(),
    ...overrides,
  };
}

function musicState(overrides: Partial<MusicState> = {}): MusicState {
  return {
    tracks: [{ videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' }],
    currentIndex: 0,
    isPlaying: false,
    positionSeconds: 10,
    updatedAt: Date.now(),
    ...overrides,
  };
}

// Simula la respuesta pública del oEmbed de YouTube (sin API key), que el
// admin consulta al agregar una canción para resolver su título (ver
// fetchYouTubeTitle en ambientMusic.ts).
function mockOEmbed(title: string) {
  return jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ title }),
    } as Response),
  );
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
    global.fetch = mockOEmbed('Love Song Baby') as unknown as typeof fetch;
  });

  it('solo el administrador ve el botón para agregar música', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    render(<AmbientMusicPlayer socket={fakeSocket() as never} isAdmin={false} />);

    expect(screen.queryByRole('button', { name: 'Agregar música' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Pegá un link o ID de YouTube')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unirme a la música' })).toBeInTheDocument();
  });

  it('para el admin, el panel con el link y los controles arranca cerrado y se abre con "Agregar música"', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    render(<AmbientMusicPlayer socket={fakeSocket() as never} isAdmin />);

    const toggle = screen.getByRole('button', { name: 'Agregar música' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByPlaceholderText('Pegá un link o ID de YouTube')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByPlaceholderText('Pegá un link o ID de YouTube')).toBeInTheDocument();
  });

  it('el admin agrega una canción: resuelve el título por oEmbed, manda musicAddTrack y limpia el input', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));

    const input = screen.getByPlaceholderText('Pegá un link o ID de YouTube');
    fireEvent.change(input, { target: { value: ' dQw4w9WgXcQ ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Elegir canción' }));

    await waitFor(() =>
      expect(socket.emit).toHaveBeenCalledWith('musicAddTrack', {
        videoId: 'dQw4w9WgXcQ',
        title: 'Love Song Baby',
      }),
    );
    expect(input).toHaveValue('');
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('watch%3Fv%3DdQw4w9WgXcQ'));
  });

  it('si no se puede resolver el título (oEmbed falla), muestra un error y no manda musicAddTrack', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false } as Response)) as unknown as typeof fetch;
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));

    fireEvent.change(screen.getByPlaceholderText('Pegá un link o ID de YouTube'), {
      target: { value: 'not-a-real-video' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Elegir canción' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(socket.emit).not.toHaveBeenCalledWith('musicAddTrack', expect.anything());
  });

  it('con 2 canciones agregadas, la playlist muestra sus títulos y la que suena queda marcada', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));

    act(() =>
      socket.handlers.musicState(
        musicState({
          tracks: [
            { videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' },
            { videoId: 'jNQXAC9IVRw', title: 'Otro Tema' },
          ],
          currentIndex: 0,
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver playlist' }));

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Love Song Baby');
    expect(items[1]).toHaveTextContent('Otro Tema');
    expect(items[0]).toHaveAttribute('aria-current', 'true');
    expect(items[1]).not.toHaveAttribute('aria-current');
  });

  it('la playlist está colapsada por defecto y se muestra al clickear "Ver playlist"', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));

    act(() =>
      socket.handlers.musicState(
        musicState({
          tracks: [
            { videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' },
            { videoId: 'jNQXAC9IVRw', title: 'Otro Tema' },
          ],
          currentIndex: 0,
        }),
      ),
    );

    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ver playlist' }));

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('sacar una canción de la lista manda musicRemoveTrack con su índice', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));
    act(() =>
      socket.handlers.musicState(
        musicState({
          tracks: [
            { videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' },
            { videoId: 'jNQXAC9IVRw', title: 'Otro Tema' },
          ],
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver playlist' }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Sacar de la lista' })[1]);

    expect(socket.emit).toHaveBeenCalledWith('musicRemoveTrack', { index: 1 });
  });

  it('clickear una canción de la lista que no es la actual manda musicJumpToTrack con su índice', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));
    act(() =>
      socket.handlers.musicState(
        musicState({
          tracks: [
            { videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' },
            { videoId: 'jNQXAC9IVRw', title: 'Otro Tema' },
          ],
          currentIndex: 0,
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver playlist' }));

    const items = screen.getAllByRole('listitem');
    fireEvent.click(items[1]);

    expect(socket.emit).toHaveBeenCalledWith('musicJumpToTrack', { index: 1 });
  });

  it('clickear la canción que ya está sonando no manda nada (ya es la actual)', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));
    act(() =>
      socket.handlers.musicState(
        musicState({
          tracks: [
            { videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' },
            { videoId: 'jNQXAC9IVRw', title: 'Otro Tema' },
          ],
          currentIndex: 0,
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver playlist' }));

    const items = screen.getAllByRole('listitem');
    fireEvent.click(items[0]);

    expect(socket.emit).not.toHaveBeenCalledWith('musicJumpToTrack', expect.anything());
  });

  it('anterior/siguiente son íconos sin texto, deshabilitados en los extremos de la lista, y mandan musicPrevious/musicNext', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));
    act(() =>
      socket.handlers.musicState(
        musicState({
          tracks: [
            { videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' },
            { videoId: 'jNQXAC9IVRw', title: 'Otro Tema' },
          ],
          currentIndex: 0,
        }),
      ),
    );

    const previous = screen.getByRole('button', { name: 'Anterior' });
    const next = screen.getByRole('button', { name: 'Siguiente' });
    expect(previous).toBeDisabled();
    expect(previous).not.toHaveTextContent('Anterior');
    expect(next).not.toBeDisabled();

    fireEvent.click(next);
    expect(socket.emit).toHaveBeenCalledWith('musicNext');

    act(() => socket.handlers.musicState(musicState({ currentIndex: 1 })));
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(socket.emit).toHaveBeenCalledWith('musicPrevious');
  });

  it('el botón de reproducir/pausar es un solo ícono que alterna según isPlaying y está deshabilitado sin canciones', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));

    expect(screen.queryByRole('button', { name: 'Reproducir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();

    act(() => socket.handlers.musicState(musicState({ isPlaying: false, positionSeconds: 7 })));

    const playButton = screen.getByRole('button', { name: 'Reproducir' });
    expect(playButton).not.toHaveTextContent('Reproducir');
    fireEvent.click(playButton);
    expect(socket.emit).toHaveBeenCalledWith('musicPlay', { positionSeconds: 7 });

    act(() => socket.handlers.musicState(musicState({ isPlaying: true, positionSeconds: 7 })));
    const pauseButton = screen.getByRole('button', { name: 'Pausar' });
    fireEvent.click(pauseButton);
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
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());

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
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());
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

  it('solo el admin ve la barra de avance (no admin, ni con canción sonando)', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin={false} />);

    act(() => socket.handlers.musicState(musicState({ isPlaying: false, positionSeconds: 10 })));

    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('muestra el tiempo transcurrido y la duración total una vez que el player la reporta', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));

    act(() => socket.handlers.musicState(musicState({ isPlaying: false, positionSeconds: 45 })));

    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    playerInstance.getDuration.mockReturnValue(180);
    act(() => capturedOptions.events?.onReady?.());
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());

    expect(screen.getByText('0:45 / 3:00')).toBeInTheDocument();
  });

  it('arrastrar la barra de avance y soltarla manda musicSeek con la posición elegida, sin llamar a seekTo desde la UI', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));

    act(() => socket.handlers.musicState(musicState({ isPlaying: false, positionSeconds: 10 })));

    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    playerInstance.getDuration.mockReturnValue(180);
    act(() => capturedOptions.events?.onReady?.());
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());

    const slider = screen.getByRole('slider', { name: 'Avance de la canción' });
    fireEvent.change(slider, { target: { value: '90' } });
    expect(socket.emit).not.toHaveBeenCalledWith('musicSeek', expect.anything());

    fireEvent.mouseUp(slider);

    expect(socket.emit).toHaveBeenCalledWith('musicSeek', { positionSeconds: 90 });
    expect(playerInstance.seekTo).not.toHaveBeenCalled();
  });

  it('el admin nunca ve el botón "Unirme a la música", ni antes de recibir musicState', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    render(<AmbientMusicPlayer socket={fakeSocket() as never} isAdmin />);

    expect(screen.queryByRole('button', { name: 'Unirme a la música' })).not.toBeInTheDocument();
  });

  it('el admin se une solo a la música, sin clickear nada', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);

    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());
  });

  it('una vez unido, el admin ve el control de volumen', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());

    expect(screen.getByRole('slider', { name: 'Volumen de la música' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Silenciar música' })).toBeInTheDocument();
  });

  it('una vez unido, un invitado también ve el control de volumen', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unirme a la música' }));
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());

    expect(screen.getByRole('slider', { name: 'Volumen de la música' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Silenciar música' })).toBeInTheDocument();
  });

  it('mover el slider de volumen llama a setVolume en el player y no emite nada por el socket', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());

    const slider = screen.getByRole('slider', { name: 'Volumen de la música' });
    fireEvent.change(slider, { target: { value: '40' } });

    expect(playerInstance.setVolume).toHaveBeenCalledWith(40);
    expect(socket.emit).not.toHaveBeenCalledWith(expect.stringMatching(/volume/i), expect.anything());
  });

  it('clickear el ícono de silenciar llama a mute(), cambia el ícono/label, y clickear de nuevo llama a unMute()', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());
    playerInstance.unMute.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Silenciar música' }));
    expect(playerInstance.mute).toHaveBeenCalled();

    const unmuteButton = screen.getByRole('button', { name: 'Activar sonido de la música' });
    fireEvent.click(unmuteButton);
    expect(playerInstance.unMute).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Silenciar música' })).toBeInTheDocument();
  });

  it('arrastrar el slider de volumen estando silenciado también llama a unMute()', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());
    playerInstance.unMute.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Silenciar música' }));
    expect(playerInstance.mute).toHaveBeenCalled();

    const slider = screen.getByRole('slider', { name: 'Volumen de la música' });
    fireEvent.change(slider, { target: { value: '60' } });

    expect(playerInstance.setVolume).toHaveBeenCalledWith(60);
    expect(playerInstance.unMute).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Silenciar música' })).toBeInTheDocument();
  });

  it('al desmontar, destruye el player y deja de escuchar al socket', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    const { unmount } = render(<AmbientMusicPlayer socket={socket as never} isAdmin={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Unirme a la música' }));
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());

    unmount();

    expect(playerInstance.destroy).toHaveBeenCalled();
    expect(socket.off).toHaveBeenCalledWith('musicState', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
