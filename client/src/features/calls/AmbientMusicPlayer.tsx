'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
} from 'react';
import type { Socket } from 'socket.io-client';
import { useTranslation } from '../translation/useTranslation';
import {
  currentTrack,
  fetchYouTubeTitle,
  formatTime,
  reconcilePlayerState,
  type MusicState,
} from './ambientMusic';
import styles from './AmbientMusicPlayer.module.css';

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 4l14 8-14 8V4z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="7" y1="4" x2="7" y2="20" />
      <line x1="17" y1="4" x2="17" y2="20" />
    </svg>
  );
}

function PreviousIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="4" x2="6" y2="20" />
      <path d="M18 4l-10 8 10 8V4z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 4l10 8-10 8V4z" />
      <line x1="18" y1="4" x2="18" y2="20" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function MusicNoteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="4 9 8 9 13 4 13 20 8 15 4 15 4 9" />
      <path d="M16 8a5 5 0 0 1 0 8" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function VolumeMutedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="4 9 8 9 13 4 13 20 8 15 4 15 4 9" />
      <line x1="16" y1="9" x2="22" y2="15" />
      <line x1="22" y1="9" x2="16" y2="15" />
    </svg>
  );
}

const YT_SCRIPT_SRC = 'https://www.youtube.com/iframe_api';
const PLAYER_ELEMENT_ID = 'ambient-music-player';

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    if (!document.querySelector(`script[src="${YT_SCRIPT_SRC}"]`)) {
      const script = document.createElement('script');
      script.src = YT_SCRIPT_SRC;
      document.body.appendChild(script);
    }
  });
}

interface AmbientMusicPlayerProps {
  socket: Socket;
  isAdmin: boolean;
}

export function AmbientMusicPlayer({ socket, isAdmin }: AmbientMusicPlayerProps) {
  const { t } = useTranslation();
  const [musicState, setMusicState] = useState<MusicState | null>(null);
  const [joined, setJoined] = useState(false);
  const [open, setOpen] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [trackInput, setTrackInput] = useState('');
  const [resolvingTitle, setResolvingTitle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const playerRef = useRef<YT.Player | null>(null);
  const loadedVideoId = useRef<string | null>(null);
  const pendingState = useRef<MusicState | null>(null);

  useEffect(() => {
    function onMusicState(state: MusicState) {
      pendingState.current = state;
      setMusicState(state);
      setPosition(
        state.positionSeconds +
          (state.isPlaying ? Math.max(0, (Date.now() - state.updatedAt) / 1000) : 0),
      );
      if (playerRef.current) {
        reconcilePlayerState(playerRef.current, loadedVideoId.current, state);
        loadedVideoId.current = currentTrack(state)?.videoId ?? null;
        setDuration(playerRef.current.getDuration() || 0);
      }
    }
    function onError({ message }: { message: string }) {
      setError(message);
    }
    socket.on('musicState', onMusicState);
    socket.on('error', onError);
    return () => {
      socket.off('musicState', onMusicState);
      socket.off('error', onError);
    };
  }, [socket]);

  useEffect(() => {
    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  // Posición mostrada en la barra de avance: misma fórmula que usa
  // reconcilePlayerState para el player, no lee player.getCurrentTime(). Así
  // la barra muestra lo mismo que ve el resto de la sala, no lo que arrastra
  // el buffer local del admin.
  useEffect(() => {
    if (!musicState?.isPlaying) return;
    function tick() {
      const elapsedSinceUpdate = musicState!.isPlaying
        ? Math.max(0, (Date.now() - musicState!.updatedAt) / 1000)
        : 0;
      setPosition(musicState!.positionSeconds + elapsedSinceUpdate);
    }
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [musicState]);

  // new YT.Player(...) devuelve el objeto al toque, pero sus métodos
  // (unMute, playVideo, etc.) recién quedan disponibles cuando el iframe
  // termina de inicializar y dispara onReady. Por eso createPlayer no
  // resuelve en la construcción: guarda la promesa de "ya está listo" en un
  // ref (no en playerRef, que solo guarda la instancia) para que llamadas
  // concurrentes esperen el mismo onReady en vez de crear dos players.
  const playerReady = useRef<Promise<void> | null>(null);

  const createPlayer = useCallback(() => {
    if (playerReady.current) return playerReady.current;
    playerReady.current = (async () => {
      await loadYouTubeApi();
      await new Promise<void>((resolve) => {
        playerRef.current = new window.YT!.Player(PLAYER_ELEMENT_ID, {
          height: '1',
          width: '1',
          events: {
            onReady: () => {
              const player = playerRef.current;
              const state = pendingState.current;
              if (player && state) {
                reconcilePlayerState(player, loadedVideoId.current, state);
                loadedVideoId.current = currentTrack(state)?.videoId ?? null;
                setDuration(player.getDuration() || 0);
              }
              resolve();
            },
            // getDuration() en onReady suele devolver 0: el iframe recién
            // está cargando metadata del video. onStateChange es el único
            // evento que avisa cuando ya está disponible, así que se vuelve
            // a leer ahí.
            onStateChange: () => {
              const player = playerRef.current;
              if (player) setDuration(player.getDuration() || 0);
            },
            onError: () => setError(t('No se pudo reproducir ese video. Probá con otro link.')),
          },
        });
      });
    })();
    return playerReady.current;
  }, [t]);

  const handleJoinMusic = useCallback(() => {
    return createPlayer().then(() => {
      playerRef.current?.unMute();
      setJoined(true);
    });
  }, [createPlayer]);

  // El admin controla la música de la sala: pedirle que "se una" a su propia
  // playlist es una fricción sin sentido, así que se une solo. Para el
  // momento en que este componente es interactivo ya hubo un gesto del
  // usuario en la página (entrar a la reunión), así que unMute() desde un
  // efecto no choca con la política de autoplay con sonido del navegador.
  useEffect(() => {
    if (isAdmin) void handleJoinMusic();
  }, [isAdmin, handleJoinMusic]);

  function handleToggleMute() {
    const next = !muted;
    setMuted(next);
    if (next) playerRef.current?.mute();
    else playerRef.current?.unMute();
  }

  // setVolume() de la API de YouTube no deshace un mute() previo: el audio
  // sigue en silencio hasta un unMute() explícito. Por eso, tocar el slider
  // también limpia el muted local (mismo comportamiento que el control de
  // volumen nativo de <video>/<audio>).
  function handleVolumeChange(e: ChangeEvent<HTMLInputElement>) {
    const value = Number(e.target.value);
    setVolume(value);
    playerRef.current?.setVolume(value);
    if (muted) {
      setMuted(false);
      playerRef.current?.unMute();
    }
  }

  async function handleAddTrack(e: FormEvent) {
    e.preventDefault();
    const videoId = trackInput.trim();
    if (!videoId || resolvingTitle) return;
    setResolvingTitle(true);
    setError(null);
    try {
      const title = await fetchYouTubeTitle(videoId);
      socket.emit('musicAddTrack', { videoId, title });
      setTrackInput('');
    } catch {
      setError(t('No se pudo obtener la información de ese video. Probá con otro link.'));
    } finally {
      setResolvingTitle(false);
    }
  }

  function currentPosition(): number {
    return playerRef.current?.getCurrentTime() ?? musicState?.positionSeconds ?? 0;
  }

  function handleTogglePlay() {
    if (musicState?.isPlaying) socket.emit('musicPause', { positionSeconds: currentPosition() });
    else socket.emit('musicPlay', { positionSeconds: currentPosition() });
  }

  function handlePrevious() {
    socket.emit('musicPrevious');
  }

  function handleNext() {
    socket.emit('musicNext');
  }

  function handleRemoveTrack(index: number) {
    socket.emit('musicRemoveTrack', { index });
  }

  function handleJumpToTrack(index: number) {
    socket.emit('musicJumpToTrack', { index });
  }

  function handleSeekChange(e: ChangeEvent<HTMLInputElement>) {
    setScrubPosition(Number(e.target.value));
  }

  // Igual que handleTogglePlay: solo emite musicSeek y deja que
  // reconcilePlayerState aplique la posición cuando llegue el próximo
  // musicState. Nunca llama a player.seekTo desde la UI (ver invariante
  // documentado en reconcilePlayerState, ambientMusic.ts).
  function commitSeek() {
    if (scrubPosition === null) return;
    socket.emit('musicSeek', { positionSeconds: scrubPosition });
    setScrubPosition(null);
  }

  const current = musicState ? currentTrack(musicState) : null;
  const scrubbing = scrubPosition !== null;
  const clampedPosition = duration > 0 ? Math.min(position, duration) : position;
  const displayPosition = scrubbing ? scrubPosition : clampedPosition;
  const seekPercent = duration > 0 ? Math.min(100, (displayPosition / duration) * 100) : 0;

  return (
    <div className={styles.ambientMusic}>
      <div id={PLAYER_ELEMENT_ID} className={styles.hiddenPlayer} />
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <MusicNoteIcon />
          <span>{t('Música')}</span>
        </div>
        {!joined && !isAdmin && (
          <button type="button" className={styles.joinButton} onClick={handleJoinMusic}>
            {t('Unirme a la música')}
          </button>
        )}
        {joined && (
          <div className={styles.volumeRow}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={handleToggleMute}
              title={muted ? t('Activar sonido de la música') : t('Silenciar música')}
              aria-label={muted ? t('Activar sonido de la música') : t('Silenciar música')}
            >
              {muted ? <VolumeMutedIcon /> : <VolumeIcon />}
            </button>
            <input
              type="range"
              className={styles.volumeBar}
              style={{ '--volume-fill': `${volume}%` } as CSSProperties}
              min={0}
              max={100}
              value={volume}
              onChange={handleVolumeChange}
              aria-label={t('Volumen de la música')}
            />
          </div>
        )}
        {isAdmin && (
          <div className={styles.adminControls}>
            <button
              type="button"
              className={styles.toggleButton}
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
            >
              {t('Agregar música')}
              <span className={open ? styles.chevronOpen : styles.chevron}>
                <ChevronIcon />
              </span>
            </button>
            {open && (
              <div className={styles.panel}>
                <form onSubmit={handleAddTrack} className={styles.trackForm}>
                  <input
                    value={trackInput}
                    onChange={(e) => setTrackInput(e.target.value)}
                    placeholder={t('Pegá un link o ID de YouTube')}
                  />
                  <button
                    type="submit"
                    className={styles.iconButton}
                    disabled={resolvingTitle}
                    title={t('Elegir canción')}
                    aria-label={t('Elegir canción')}
                  >
                    <PlusIcon />
                  </button>
                </form>
                {musicState && musicState.tracks.length > 0 && (
                  <>
                    {current && (
                      <p className={styles.nowPlaying} title={current.title}>
                        {current.title}
                      </p>
                    )}
                    {current && (
                      <div className={styles.seekRow}>
                        <input
                          type="range"
                          className={styles.seekBar}
                          style={{ '--seek-fill': `${seekPercent}%` } as CSSProperties}
                          min={0}
                          max={duration > 0 ? duration : 0}
                          step={1}
                          value={displayPosition}
                          disabled={duration <= 0}
                          onChange={handleSeekChange}
                          onPointerUp={commitSeek}
                          onMouseUp={commitSeek}
                          onTouchEnd={commitSeek}
                          onBlur={commitSeek}
                          aria-label={t('Avance de la canción')}
                        />
                        <span className={styles.seekTime}>
                          {formatTime(displayPosition)} / {formatTime(duration)}
                        </span>
                      </div>
                    )}
                    <div className={styles.playbackButtons}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={handlePrevious}
                        disabled={musicState.currentIndex <= 0}
                        title={t('Anterior')}
                        aria-label={t('Anterior')}
                      >
                        <PreviousIcon />
                      </button>
                      <button
                        type="button"
                        className={styles.playButton}
                        onClick={handleTogglePlay}
                        title={musicState.isPlaying ? t('Pausar') : t('Reproducir')}
                        aria-label={musicState.isPlaying ? t('Pausar') : t('Reproducir')}
                      >
                        {musicState.isPlaying ? <PauseIcon /> : <PlayIcon />}
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={handleNext}
                        disabled={musicState.currentIndex >= musicState.tracks.length - 1}
                        title={t('Siguiente')}
                        aria-label={t('Siguiente')}
                      >
                        <NextIcon />
                      </button>
                    </div>
                    <button
                      type="button"
                      className={styles.toggleButton}
                      onClick={() => setShowPlaylist((value) => !value)}
                      aria-expanded={showPlaylist}
                    >
                      {t('Ver playlist')}
                      <span className={showPlaylist ? styles.chevronOpen : styles.chevron}>
                        <ChevronIcon />
                      </span>
                    </button>
                    {showPlaylist && (
                      <ol className={styles.playlist}>
                        {musicState.tracks.map((track, index) => {
                          const isCurrent = index === musicState.currentIndex;
                          return (
                            <li
                              key={`${track.videoId}-${index}`}
                              className={isCurrent ? styles.trackActive : styles.track}
                              aria-current={isCurrent ? 'true' : undefined}
                              tabIndex={isCurrent ? undefined : 0}
                              onClick={isCurrent ? undefined : () => handleJumpToTrack(index)}
                              onKeyDown={
                                isCurrent
                                  ? undefined
                                  : (e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        handleJumpToTrack(index);
                                      }
                                    }
                              }
                            >
                              <span className={styles.trackIndex}>{index + 1}</span>
                              <span className={styles.trackTitle}>{track.title}</span>
                              <button
                                type="button"
                                className={styles.removeButton}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveTrack(index);
                                }}
                                title={t('Sacar de la lista')}
                                aria-label={t('Sacar de la lista')}
                              >
                                <RemoveIcon />
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
