export interface MusicState {
  videoId: string;
  isPlaying: boolean;
  positionSeconds: number;
  updatedAt: number;
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
  const elapsed = state.isPlaying ? Math.max(0, (Date.now() - state.updatedAt) / 1000) : 0;
  const target = state.positionSeconds + elapsed;

  if (state.videoId !== loadedVideoId) {
    if (state.isPlaying) player.loadVideoById(state.videoId, target);
    else player.cueVideoById(state.videoId, target);
    return;
  }

  if (Math.abs(player.getCurrentTime() - target) > DRIFT_TOLERANCE_SECONDS) {
    player.seekTo(target, true);
  }
  if (state.isPlaying) player.playVideo();
  else player.pauseVideo();
}
