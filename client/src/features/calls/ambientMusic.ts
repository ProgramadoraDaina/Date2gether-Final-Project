export interface MusicTrack {
  videoId: string;
  title: string;
}

export type PlaybackMode = 'sequence' | 'repeat-all' | 'repeat-one' | 'once';

export const PLAYBACK_MODE_ORDER: PlaybackMode[] = ['sequence', 'repeat-all', 'repeat-one', 'once'];

export const PLAYBACK_MODE_LABELS: Record<PlaybackMode, string> = {
  sequence: 'Todo seguido',
  'repeat-all': 'Repetir lista',
  'repeat-one': 'Repetir esta canción',
  once: 'Solo esta canción',
};

export interface MusicState {
  tracks: MusicTrack[];
  currentIndex: number;
  isPlaying: boolean;
  positionSeconds: number;
  updatedAt: number;
  mode: PlaybackMode;
  shuffle: boolean;
  // Tope que fija el admin para toda la sala; sin definir equivale a 100.
  roomVolume?: number;
}

// Tu volumen se aplica encima del de la sala: si el admin la baja a la mitad, tu 100 suena a 50.
export function effectiveVolume(personal: number, roomVolume?: number): number {
  return Math.round((personal * (roomVolume ?? 100)) / 100);
}

export function currentTrack(state: MusicState): MusicTrack | null {
  return state.tracks[state.currentIndex] ?? null;
}

export function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalSeconds = Math.floor(safeSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function toWatchUrl(input: string): string {
  return /^https?:\/\//i.test(input) ? input : `https://www.youtube.com/watch?v=${input}`;
}

// oEmbed público de YouTube: no requiere API key ni autenticación, y permite
// pedirlo directo desde el navegador (CORS habilitado). Solo se usa para
// mostrar el título de la canción; el id real sigue validándose en el
// servidor (ver extractYouTubeId en chat.gateway.ts) antes de guardarlo.
export async function fetchYouTubeTitle(input: string): Promise<string> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(toWatchUrl(input))}&format=json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('No se pudo resolver el título del video');
  const data = (await response.json()) as { title: string };
  return data.title;
}

// No vale la pena perseguir sample-accuracy entre clientes: alcanza con que
// todos queden dentro de ~1s de diferencia (acordado como tradeoff aceptado).
const DRIFT_TOLERANCE_SECONDS = 1;

// Reconcilia el player local de YouTube contra el estado compartido de la
// sala. El player nunca se controla directamente desde los botones de la UI
// (ver AmbientMusicPlayer): siempre reacciona a `musicState`, igual para el
// admin que para el resto, así nadie puede desincronizarse de lo que ve el
// resto de la sala.
// Posición en la que debería estar la sala ahora mismo.
export function roomPosition(state: MusicState, now = Date.now()): number {
  const elapsed = state.isPlaying ? Math.max(0, (now - state.updatedAt) / 1000) : 0;
  return state.positionSeconds + elapsed;
}

// Saltar obliga a YouTube a volver a cargar (~0.5-1 s de silencio): solo conviene si el desfase es mayor.
const RESYNC_TOLERANCE_SECONDS = 1.5;

// YouTube tarda en cargar: cuando arranca de verdad, se salta a donde ya va la sala.
export function resyncTarget(
  state: MusicState,
  currentTime: number,
  now = Date.now(),
): number | null {
  if (!state.isPlaying) return null;
  const target = roomPosition(state, now);
  return Math.abs(currentTime - target) > RESYNC_TOLERANCE_SECONDS ? target : null;
}

export function reconcilePlayerState(
  player: YT.Player,
  loadedVideoId: string | null,
  state: MusicState,
): void {
  const track = currentTrack(state);
  // Lista vacía (nunca se eligió nada, o se sacaron todas las canciones): no
  // hay nada que cargar ni reproducir.
  if (!track) return;

  const target = roomPosition(state);

  if (track.videoId !== loadedVideoId) {
    if (state.isPlaying) player.loadVideoById(track.videoId, target);
    else player.cueVideoById(track.videoId, target);
    return;
  }

  if (Math.abs(player.getCurrentTime() - target) > DRIFT_TOLERANCE_SECONDS) {
    player.seekTo(target, true);
  }
  if (state.isPlaying) player.playVideo();
  else player.pauseVideo();
}
