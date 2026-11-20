import { describe, expect, it } from 'vitest';
import { afterTrackEnded, skipToNext, type PlaybackState } from './music-playback';

const tracks = [
  { videoId: 'aaaaaaaaaaa', title: 'Uno' },
  { videoId: 'bbbbbbbbbbb', title: 'Dos' },
  { videoId: 'ccccccccccc', title: 'Tres' },
];

function state(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return {
    tracks,
    currentIndex: 0,
    isPlaying: true,
    positionSeconds: 95,
    mode: 'sequence',
    shuffle: false,
    played: [0],
    ...overrides,
  };
}

const first = () => 0;

describe('afterTrackEnded', () => {
  it('todo seguido: pasa a la siguiente y arranca desde 0', () => {
    expect(afterTrackEnded(state(), first)).toMatchObject({
      currentIndex: 1,
      isPlaying: true,
      positionSeconds: 0,
    });
  });

  it('todo seguido: al terminar la última se detiene', () => {
    expect(afterTrackEnded(state({ currentIndex: 2, played: [0, 1, 2] }), first)).toMatchObject({
      currentIndex: 2,
      isPlaying: false,
      positionSeconds: 0,
    });
  });

  it('repetir lista: al terminar la última vuelve a la primera', () => {
    expect(
      afterTrackEnded(state({ mode: 'repeat-all', currentIndex: 2, played: [0, 1, 2] }), first),
    ).toMatchObject({ currentIndex: 0, isPlaying: true, positionSeconds: 0 });
  });

  it('repetir la misma: vuelve a empezar la misma canción', () => {
    expect(afterTrackEnded(state({ mode: 'repeat-one', currentIndex: 1 }), first)).toMatchObject({
      currentIndex: 1,
      isPlaying: true,
      positionSeconds: 0,
    });
  });

  it('solo esta, una vez: se detiene sin pasar a otra', () => {
    expect(afterTrackEnded(state({ mode: 'once' }), first)).toMatchObject({
      currentIndex: 0,
      isPlaying: false,
      positionSeconds: 0,
    });
  });

  it('aleatorio: elige entre las que todavía no sonaron', () => {
    const next = afterTrackEnded(state({ shuffle: true, played: [0, 1] }), first);
    expect(next).toMatchObject({ currentIndex: 2, isPlaying: true });
    expect(next.played).toEqual([0, 1, 2]);
  });

  it('aleatorio + todo seguido: cuando ya sonaron todas, se detiene', () => {
    expect(
      afterTrackEnded(state({ shuffle: true, currentIndex: 2, played: [0, 1, 2] }), first),
    ).toMatchObject({ isPlaying: false });
  });

  it('aleatorio + repetir lista: cuando ya sonaron todas, empieza otra vuelta sin repetir la actual', () => {
    const next = afterTrackEnded(
      state({ shuffle: true, mode: 'repeat-all', currentIndex: 2, played: [0, 1, 2] }),
      first,
    );
    expect(next).toMatchObject({ currentIndex: 0, isPlaying: true });
    expect(next.played).toEqual([0]);
  });
});

describe('skipToNext', () => {
  it('con repetir la misma, el botón siguiente igual pasa a la próxima', () => {
    expect(skipToNext(state({ mode: 'repeat-one' }), first)).toMatchObject({ currentIndex: 1 });
  });

  it('todo seguido en la última canción no hace nada', () => {
    expect(skipToNext(state({ currentIndex: 2 }), first)).toBeNull();
  });

  it('repetir lista en la última canción vuelve a la primera', () => {
    expect(skipToNext(state({ mode: 'repeat-all', currentIndex: 2 }), first)).toMatchObject({
      currentIndex: 0,
      positionSeconds: 0,
    });
  });
});
