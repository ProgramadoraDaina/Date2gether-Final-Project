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
    mode: 'sequence',
    shuffle: false,
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
  let capturedOptions: {
    events?: {
      onReady?: () => void;
      onError?: (e: { data: number }) => void;
      onStateChange?: (e: { data: number }) => void;
    };
  };

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
    expect(screen.queryByLabelText('Link o ID de YouTube')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unirme a la música' })).toBeInTheDocument();
  });

  it('para el admin, el panel con el link y los controles arranca cerrado y se abre con "Agregar música"', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    render(<AmbientMusicPlayer socket={fakeSocket() as never} isAdmin />);

    const toggle = screen.getByRole('button', { name: 'Agregar música' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Link o ID de YouTube')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Link o ID de YouTube')).toBeInTheDocument();
  });

  it('el admin agrega una canción: resuelve el título por oEmbed, manda musicAddTrack y limpia el input', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));

    const input = screen.getByLabelText('Link o ID de YouTube');
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

  it('el admin busca una canción por nombre y al elegir un resultado la agrega a la lista', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              videoId: 'fJ9rUzIMcZQ',
              title: 'Queen – Bohemian Rhapsody',
              channel: 'Queen Official',
              thumbnailUrl: 'https://i.ytimg.com/vi/fJ9rUzIMcZQ/default.jpg',
            },
          ]),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(
      <AmbientMusicPlayer
        socket={socket as never}
        isAdmin
        roomCode="abc-defg-hij"
        roomToken="tok"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));

    fireEvent.change(screen.getByLabelText('Buscar canción'), { target: { value: 'bohemian' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await screen.findByRole('button', { name: /Queen – Bohemian Rhapsody/ }));

    expect(socket.emit).toHaveBeenCalledWith('musicAddTrack', {
      videoId: 'fJ9rUzIMcZQ',
      title: 'Queen – Bohemian Rhapsody',
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/music-search/abc-defg-hij?q=bohemian');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('si la búsqueda falla, ofrece buscar en YouTube en otra pestaña', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response('{}', { status: 503 })),
    ) as unknown as typeof fetch;
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    render(
      <AmbientMusicPlayer
        socket={fakeSocket() as never}
        isAdmin
        roomCode="abc-defg-hij"
        roomToken="tok"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));

    fireEvent.change(screen.getByLabelText('Buscar canción'), { target: { value: 'queen live' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    const link = await screen.findByRole('link', { name: 'Buscar en YouTube' });
    expect(link).toHaveAttribute(
      'href',
      'https://www.youtube.com/results?search_query=queen%20live',
    );
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('si no se puede resolver el título (oEmbed falla), muestra un error y no manda musicAddTrack', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false } as Response),
    ) as unknown as typeof fetch;
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'Agregar música' }));

    fireEvent.change(screen.getByLabelText('Link o ID de YouTube'), {
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

  it('la playlist está colapsada por defecto y se abre con "Ver playlist" sin abrir "Agregar música"', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);

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
    expect(screen.getByRole('button', { name: 'Agregar música' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByLabelText('Link o ID de YouTube')).not.toBeInTheDocument();
  });

  it('sacar una canción pide confirmación y recién al confirmar manda musicRemoveTrack', async () => {
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

    expect(screen.getByText('¿Quitar «Otro Tema» de la lista?')).toBeInTheDocument();
    expect(socket.emit).not.toHaveBeenCalledWith('musicRemoveTrack', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));

    expect(socket.emit).toHaveBeenCalledWith('musicRemoveTrack', { index: 1 });
  });

  it('cancelar la confirmación no saca la canción', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    act(() => socket.handlers.musicState(musicState()));
    fireEvent.click(screen.getByRole('button', { name: 'Ver playlist' }));

    fireEvent.click(screen.getByRole('button', { name: 'Sacar de la lista' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(socket.emit).not.toHaveBeenCalledWith('musicRemoveTrack', expect.anything());
    expect(screen.queryByText('¿Quitar «Love Song Baby» de la lista?')).not.toBeInTheDocument();
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

  it('cuando YouTube arranca tarde por la carga, salta a donde ya va la sala', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin={false} />);
    const startedAt = Date.now() - 2500;
    act(() =>
      socket.handlers.musicState(
        musicState({ isPlaying: true, positionSeconds: 10, updatedAt: startedAt }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unirme a la música' }));
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    // YouTube recién empieza a sonar en el segundo 10, aunque la sala ya va 2,5 s adelante.
    playerInstance.getCurrentTime.mockReturnValue(10);
    playerInstance.seekTo.mockClear();

    act(() => capturedOptions.events?.onStateChange?.({ data: 1 }));

    expect(playerInstance.seekTo).toHaveBeenCalledTimes(1);
    const [target] = playerInstance.seekTo.mock.calls[0] as [number];
    expect(target).toBeGreaterThanOrEqual(12.5);
    expect(target).toBeLessThan(13.5);
  });

  it('quien se unió puede salir de la música y volver a unirse', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Unirme a la música' }));
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    fireEvent.click(await screen.findByRole('button', { name: 'Salir' }));

    expect(playerInstance.mute).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Unirme a la música' })).toBeInTheDocument();
  });

  it('el admin fija el volumen para todos con un solo mensaje por gesto', async () => {
    jest.useFakeTimers();
    try {
      const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
      const socket = fakeSocket();
      render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
      act(() => socket.handlers.musicState(musicState({})));
      const slider = screen.getByRole('slider', { name: 'Volumen para todos' });

      fireEvent.change(slider, { target: { value: '60' } });
      fireEvent.change(slider, { target: { value: '40' } });
      act(() => jest.advanceTimersByTime(300));

      const volumeEmits = socket.emit.mock.calls.filter(([event]) => event === 'musicSetVolume');
      expect(volumeEmits).toEqual([['musicSetVolume', { volume: 40 }]]);
    } finally {
      jest.useRealTimers();
    }
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

  it('el aviso de error se puede cerrar', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);

    act(() => socket.handlers.error({ message: 'El link o ID de YouTube no es válido' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('los errores del reproductor de YouTube no muestran aviso (el audio suele seguir sonando)', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Unirme a la música' }));
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    act(() => socket.handlers.musicState(musicState()));
    act(() => capturedOptions.events?.onError?.({ data: 150 }));
    act(() => capturedOptions.events?.onError?.({ data: 100 }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

    expect(screen.getByText('0:45')).toBeInTheDocument();
    expect(screen.getByText('3:00')).toBeInTheDocument();
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
    expect(socket.emit).not.toHaveBeenCalledWith(
      expect.stringMatching(/volume/i),
      expect.anything(),
    );
  });

  it('el admin activa aleatorio y cambia el modo de repetición en ciclo', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    act(() => socket.handlers.musicState(musicState()));

    fireEvent.click(screen.getByRole('button', { name: 'Aleatorio' }));
    expect(socket.emit).toHaveBeenCalledWith('musicSetMode', { mode: 'sequence', shuffle: true });

    fireEvent.click(screen.getByRole('button', { name: 'Modo: Todo seguido' }));
    expect(socket.emit).toHaveBeenCalledWith('musicSetMode', {
      mode: 'repeat-all',
      shuffle: false,
    });

    act(() => socket.handlers.musicState(musicState({ mode: 'repeat-all' })));
    fireEvent.click(screen.getByRole('button', { name: 'Modo: Repetir lista' }));
    expect(socket.emit).toHaveBeenCalledWith('musicSetMode', {
      mode: 'repeat-one',
      shuffle: false,
    });

    act(() => socket.handlers.musicState(musicState({ mode: 'repeat-one' })));
    fireEvent.click(screen.getByRole('button', { name: 'Modo: Repetir esta canción' }));
    expect(socket.emit).toHaveBeenCalledWith('musicSetMode', { mode: 'once', shuffle: false });

    act(() => socket.handlers.musicState(musicState({ mode: 'once' })));
    fireEvent.click(screen.getByRole('button', { name: 'Modo: Solo esta canción' }));
    expect(socket.emit).toHaveBeenLastCalledWith('musicSetMode', {
      mode: 'sequence',
      shuffle: false,
    });
  });

  it('en una sala permanente recuerda aleatorio y repetición del admin y los reaplica al volver', async () => {
    localStorage.setItem(
      'date2gether:music-mode:abc-defg-hij',
      JSON.stringify({ mode: 'repeat-all', shuffle: true }),
    );
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(
      <AmbientMusicPlayer socket={socket as never} isAdmin roomCode="abc-defg-hij" persistModes />,
    );

    act(() => socket.handlers.musicState(musicState()));

    expect(socket.emit).toHaveBeenCalledWith('musicSetMode', { mode: 'repeat-all', shuffle: true });
  });

  it('en una sala permanente guarda cada cambio de modo en localStorage', async () => {
    localStorage.clear();
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(
      <AmbientMusicPlayer socket={socket as never} isAdmin roomCode="abc-defg-hij" persistModes />,
    );
    act(() => socket.handlers.musicState(musicState()));

    act(() => socket.handlers.musicState(musicState({ mode: 'repeat-one', shuffle: true })));

    expect(
      JSON.parse(localStorage.getItem('date2gether:music-mode:abc-defg-hij') ?? 'null'),
    ).toEqual({
      mode: 'repeat-one',
      shuffle: true,
    });
  });

  it('en una sala temporal no guarda ni reaplica el modo', async () => {
    localStorage.setItem(
      'date2gether:music-mode:abc-defg-hij',
      JSON.stringify({ mode: 'repeat-all', shuffle: true }),
    );
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin roomCode="abc-defg-hij" />);

    act(() => socket.handlers.musicState(musicState({ mode: 'once' })));

    expect(socket.emit).not.toHaveBeenCalledWith('musicSetMode', expect.anything());
    expect(
      JSON.parse(localStorage.getItem('date2gether:music-mode:abc-defg-hij') ?? 'null'),
    ).toEqual({
      mode: 'repeat-all',
      shuffle: true,
    });
    localStorage.clear();
  });

  it('con "Repetir lista" el botón siguiente sigue activo en la última canción', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    act(() =>
      socket.handlers.musicState(
        musicState({
          tracks: [
            { videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' },
            { videoId: 'jNQXAC9IVRw', title: 'Otro Tema' },
          ],
          currentIndex: 1,
          mode: 'repeat-all',
        }),
      ),
    );

    expect(screen.getByRole('button', { name: 'Siguiente' })).not.toBeDisabled();
  });

  it('cuando termina el video avisa musicTrackEnded con el updatedAt del estado que sonaba', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    act(() => socket.handlers.musicState(musicState({ isPlaying: true, updatedAt: 4242 })));

    act(() => capturedOptions.events?.onStateChange?.({ data: 0 }));

    expect(socket.emit).toHaveBeenCalledWith('musicTrackEnded', { updatedAt: 4242 });
  });

  it('si llega música antes de que el player de YouTube esté listo, espera a onReady para cargarla', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));

    act(() => socket.handlers.musicState(musicState({ isPlaying: false })));
    expect(playerInstance.cueVideoById).not.toHaveBeenCalled();

    act(() => capturedOptions.events?.onReady?.());
    expect(playerInstance.cueVideoById).toHaveBeenCalledWith('dQw4w9WgXcQ', 10);
  });

  it('cambiar el idioma no vuelve a activar el sonido de la música silenciada', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    render(<AmbientMusicPlayer socket={fakeSocket() as never} isAdmin />);
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Silenciar música' }));

    act(() => useLanguageStore.setState({ language: 'en' }));
    await act(async () => {});

    expect(playerInstance.unMute).toHaveBeenCalledTimes(1);
    expect(playerCtor).toHaveBeenCalledTimes(1);
  });

  it('al colgar silencia la música solo en este dispositivo, sin pausarla para la sala', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    const { rerender } = render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());

    rerender(<AmbientMusicPlayer socket={socket as never} isAdmin silenced />);

    expect(playerInstance.mute).toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalledWith('musicPause', expect.anything());
  });

  it('muestra el porcentaje de volumen al lado del slider y lo actualiza al moverlo', async () => {
    const { AmbientMusicPlayer } = await import('./AmbientMusicPlayer');
    const socket = fakeSocket();
    render(<AmbientMusicPlayer socket={socket as never} isAdmin />);
    await waitFor(() => expect(playerCtor).toHaveBeenCalledTimes(1));
    act(() => capturedOptions.events?.onReady?.());
    await waitFor(() => expect(playerInstance.unMute).toHaveBeenCalled());

    expect(screen.getByText('100%')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: 'Volumen de la música' }), {
      target: { value: '40' },
    });
    expect(screen.getByText('40%')).toBeInTheDocument();
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
