export interface MusicTrack {
  videoId: string;
  title: string;
}

export interface MusicState {
  tracks: MusicTrack[];
  currentIndex: number;
  isPlaying: boolean;
  positionSeconds: number;
  updatedAt: number;
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
export function reconcilePlayerState(
  player: YT.Player,
  loadedVideoId: string | null,
  state: MusicState,
): void {
  const track = currentTrack(state);
  // Lista vacía (nunca se eligió nada, o se sacaron todas las canciones): no
  // hay nada que cargar ni reproducir.
  if (!track) return;

  const elapsed = state.isPlaying ? Math.max(0, (Date.now() - state.updatedAt) / 1000) : 0;
  const target = state.positionSeconds + elapsed;

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
