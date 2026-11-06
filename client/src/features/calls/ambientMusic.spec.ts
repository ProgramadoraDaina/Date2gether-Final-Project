import { describe, expect, it, jest } from '@jest/globals';
import { currentTrack, formatTime, reconcilePlayerState, type MusicState } from './ambientMusic';

function fakePlayer(currentTime = 0) {
  return {
    getCurrentTime: jest.fn(() => currentTime),
    seekTo: jest.fn(),
    playVideo: jest.fn(),
    pauseVideo: jest.fn(),
    loadVideoById: jest.fn(),
    cueVideoById: jest.fn(),
  };
}

function state(overrides: Partial<MusicState> = {}): MusicState {
  return {
    tracks: [{ videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' }],
    currentIndex: 0,
    isPlaying: false,
    positionSeconds: 10,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('formatTime', () => {
  it('formatea segundos a minutos:segundos sin cero inicial en los minutos', () => {
    expect(formatTime(65)).toBe('1:05');
  });

  it('redondea hacia abajo los segundos con decimales', () => {
    expect(formatTime(59.8)).toBe('0:59');
  });

  it('negativos o NaN se muestran como 0:00', () => {
    expect(formatTime(-5)).toBe('0:00');
    expect(formatTime(NaN)).toBe('0:00');
  });
});

describe('currentTrack', () => {
  it('devuelve la canción en currentIndex', () => {
    expect(
      currentTrack(
        state({
          tracks: [
            { videoId: 'a', title: 'A' },
            { videoId: 'b', title: 'B' },
          ],
          currentIndex: 1,
        }),
      ),
    ).toEqual({ videoId: 'b', title: 'B' });
  });

  it('devuelve null si la lista está vacía', () => {
    expect(currentTrack(state({ tracks: [], currentIndex: 0 }))).toBeNull();
  });
});

describe('reconcilePlayerState', () => {
  it('con la lista vacía, no toca el player', () => {
    const player = fakePlayer();
    reconcilePlayerState(player as never, null, state({ tracks: [], currentIndex: 0 }));

    expect(player.loadVideoById).not.toHaveBeenCalled();
    expect(player.cueVideoById).not.toHaveBeenCalled();
  });

  it('si cambia el video y está sonando, lo carga (autoplay) en la posición correspondiente', () => {
    const player = fakePlayer();
    reconcilePlayerState(player as never, null, state({ isPlaying: true, positionSeconds: 30 }));

    expect(player.loadVideoById).toHaveBeenCalledWith('dQw4w9WgXcQ', 30);
    expect(player.cueVideoById).not.toHaveBeenCalled();
  });

  it('si cambia el video y está pausado, solo lo precarga sin arrancar a sonar', () => {
    const player = fakePlayer();
    reconcilePlayerState(player as never, null, state({ isPlaying: false, positionSeconds: 30 }));

    expect(player.cueVideoById).toHaveBeenCalledWith('dQw4w9WgXcQ', 30);
    expect(player.loadVideoById).not.toHaveBeenCalled();
  });

  it('al avanzar a la siguiente canción de la lista (currentIndex cambia), carga el nuevo video', () => {
    const player = fakePlayer();
    reconcilePlayerState(
      player as never,
      'dQw4w9WgXcQ',
      state({
        tracks: [
          { videoId: 'dQw4w9WgXcQ', title: 'A' },
          { videoId: 'jNQXAC9IVRw', title: 'B' },
        ],
        currentIndex: 1,
        isPlaying: true,
        positionSeconds: 0,
      }),
    );

    expect(player.loadVideoById).toHaveBeenCalledWith('jNQXAC9IVRw', 0);
  });

  it('mismo video, sin drift relevante: no busca posición, solo refleja isPlaying', () => {
    const player = fakePlayer(10);
    reconcilePlayerState(
      player as never,
      'dQw4w9WgXcQ',
      state({ isPlaying: true, positionSeconds: 10, updatedAt: Date.now() }),
    );

    expect(player.seekTo).not.toHaveBeenCalled();
    expect(player.playVideo).toHaveBeenCalled();
  });

  it('mismo video, con drift mayor a la tolerancia: corrige la posición antes de reflejar isPlaying', () => {
    const player = fakePlayer(0);
    reconcilePlayerState(
      player as never,
      'dQw4w9WgXcQ',
      state({ isPlaying: true, positionSeconds: 10, updatedAt: Date.now() }),
    );

    expect(player.seekTo).toHaveBeenCalledWith(10, true);
    expect(player.playVideo).toHaveBeenCalled();
  });

  it('cuando está sonando, suma el tiempo transcurrido desde updatedAt al calcular el objetivo', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const player = fakePlayer(0);

    reconcilePlayerState(
      player as never,
      'dQw4w9WgXcQ',
      state({ isPlaying: true, positionSeconds: 10, updatedAt: now - 5000 }),
    );

    expect(player.seekTo).toHaveBeenCalledWith(15, true);
    jest.restoreAllMocks();
  });

  it('cuando está pausado, usa la posición tal cual, sin sumar tiempo transcurrido', () => {
    const player = fakePlayer(0);
    reconcilePlayerState(
      player as never,
      'dQw4w9WgXcQ',
      state({ isPlaying: false, positionSeconds: 10, updatedAt: Date.now() - 999999 }),
    );

    expect(player.seekTo).toHaveBeenCalledWith(10, true);
    expect(player.pauseVideo).toHaveBeenCalled();
    expect(player.playVideo).not.toHaveBeenCalled();
  });
});
