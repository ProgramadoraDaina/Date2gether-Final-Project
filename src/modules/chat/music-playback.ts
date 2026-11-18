export const PLAYBACK_MODES = ['sequence', 'repeat-all', 'repeat-one', 'once'] as const;
export type PlaybackMode = (typeof PLAYBACK_MODES)[number];

export interface PlaybackTrack {
  videoId: string;
  title: string;
}

export interface PlaybackState {
  tracks: PlaybackTrack[];
  currentIndex: number;
  isPlaying: boolean;
  positionSeconds: number;
  mode: PlaybackMode;
  shuffle: boolean;
  // Indices already played in the current pass; shuffle never repeats one until the pass ends.
  played: number[];
}

type Random = () => number;

function pickNext(
  state: PlaybackState,
  wrap: boolean,
  random: Random,
): Partial<PlaybackState> | null {
  const count = state.tracks.length;
  if (count === 0) return null;

  if (!state.shuffle) {
    const next = state.currentIndex + 1;
    if (next < count) return { currentIndex: next, played: [...state.played, next] };
    return wrap ? { currentIndex: 0, played: [0] } : null;
  }

  const unplayed = state.tracks.map((_, i) => i).filter((i) => !state.played.includes(i));
  if (unplayed.length > 0) {
    const index = unplayed[Math.floor(random() * unplayed.length)];
    return { currentIndex: index, played: [...state.played, index] };
  }
  if (!wrap) return null;
  const others = state.tracks.map((_, i) => i).filter((i) => i !== state.currentIndex);
  const pool = others.length > 0 ? others : [state.currentIndex];
  const index = pool[Math.floor(random() * pool.length)];
  return { currentIndex: index, played: [index] };
}

export function afterTrackEnded(state: PlaybackState, random: Random = Math.random): PlaybackState {
  if (state.mode === 'once') return { ...state, isPlaying: false, positionSeconds: 0 };
  if (state.mode === 'repeat-one') return { ...state, isPlaying: true, positionSeconds: 0 };
  const next = pickNext(state, state.mode === 'repeat-all', random);
  if (!next) return { ...state, isPlaying: false, positionSeconds: 0 };
  return { ...state, ...next, isPlaying: true, positionSeconds: 0 };
}

export function skipToNext(
  state: PlaybackState,
  random: Random = Math.random,
): PlaybackState | null {
  const next = pickNext(state, state.mode === 'repeat-all', random);
  return next ? { ...state, ...next, positionSeconds: 0 } : null;
}
