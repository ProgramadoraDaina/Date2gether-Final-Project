// Tipado mínimo del IFrame Player API de YouTube: alcanza con lo que usa
// AmbientMusicPlayer, no es una definición completa de la API.
declare namespace YT {
  interface OnStateChangeEvent {
    data: number;
  }

  interface PlayerEvents {
    onReady?: () => void;
    onError?: (event: { data: number }) => void;
    onStateChange?: (event: OnStateChangeEvent) => void;
  }

  interface PlayerOptions {
    height?: string | number;
    width?: string | number;
    videoId?: string;
    playerVars?: Record<string, number | string>;
    events?: PlayerEvents;
  }

  class Player {
    constructor(elementId: string | HTMLElement, options: PlayerOptions);
    loadVideoById(videoId: string, startSeconds?: number): void;
    cueVideoById(videoId: string, startSeconds?: number): void;
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    getCurrentTime(): number;
    getDuration(): number;
    mute(): void;
    unMute(): void;
    setVolume(volume: number): void;
    destroy(): void;
  }
}

interface Window {
  YT?: typeof YT;
  onYouTubeIframeAPIReady?: () => void;
}
