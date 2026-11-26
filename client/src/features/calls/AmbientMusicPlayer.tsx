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
import { searchMusic, youTubeSearchUrl, type MusicSearchResult } from '@/lib/musicSearch';
import { useTranslation } from '../translation/useTranslation';
import {
  currentTrack,
  effectiveVolume,
  fetchYouTubeTitle,
  formatTime,
  PLAYBACK_MODE_LABELS,
  PLAYBACK_MODE_ORDER,
  reconcilePlayerState,
  resyncTarget,
  roomPosition,
  type MusicState,
  type PlaybackMode,
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

function ShuffleIcon() {
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
      <path d="M16 3h5v5" />
      <path d="M4 20 21 3" />
      <path d="M21 16v5h-5" />
      <path d="M15 15l6 6" />
      <path d="M4 4l5 5" />
    </svg>
  );
}

function RepeatIcon({ mode }: { mode: PlaybackMode }) {
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
      {mode === 'once' ? (
        <path d="M5 12h14M13 6l6 6-6 6" />
      ) : (
        <>
          <path d="M17 2l4 4-4 4" />
          <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path d="M7 22l-4-4 4-4" />
          <path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </>
      )}
      {(mode === 'repeat-one' || mode === 'once') && (
        <text x="12" y="15.5" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">
          1
        </text>
      )}
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

function EqualizerBars() {
  return (
    <span className={styles.equalizer} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
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

const MODE_STORAGE_PREFIX = 'date2gether:music-mode:';

function readStoredMode(key: string): { mode: PlaybackMode; shuffle: boolean } | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as {
      mode?: unknown;
      shuffle?: unknown;
    } | null;
    if (
      parsed &&
      PLAYBACK_MODE_ORDER.includes(parsed.mode as PlaybackMode) &&
      typeof parsed.shuffle === 'boolean'
    ) {
      return { mode: parsed.mode as PlaybackMode, shuffle: parsed.shuffle };
    }
  } catch {
    // Corrupt or unavailable storage: ignore it.
  }
  return null;
}

interface AmbientMusicPlayerProps {
  socket: Socket;
  isAdmin: boolean;
  roomCode?: string;
  roomToken?: string;
  // Permanent rooms remember shuffle/repeat in the admin's browser.
  persistModes?: boolean;
  // After hanging up the music goes quiet on this device only; the room keeps playing.
  silenced?: boolean;
}

export function AmbientMusicPlayer({
  socket,
  isAdmin,
  roomCode,
  roomToken,
  persistModes = false,
  silenced = false,
}: AmbientMusicPlayerProps) {
  const { t } = useTranslation();
  const [musicState, setMusicState] = useState<MusicState | null>(null);
  const [joined, setJoined] = useState(false);
  const [open, setOpen] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const [trackInput, setTrackInput] = useState('');
  const [resolvingTitle, setResolvingTitle] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MusicSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  const playerRef = useRef<YT.Player | null>(null);
  const loadedVideoId = useRef<string | null>(null);
  const pendingState = useRef<MusicState | null>(null);
  const modeRestored = useRef(false);
  // YT.Player exists right after construction but its methods only after onReady.
  const playerIsReady = useRef(false);
  // Precarga: con la sala en pausa, el video suena un instante en silencio para que ▶ no arranque en frío.
  const priming = useRef(false);
  // Último estado de YouTube (1 = sonando): la barra solo lo lee cuando ya suena la canción correcta.
  const playerState = useRef(-1);
  const mutedRef = useRef(false);
  const socketRef = useRef(socket);
  // A ref so a language switch does not recreate the player and re-run the admin auto-join.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    function onMusicState(state: MusicState) {
      if (isAdmin && persistModes && roomCode) syncStoredMode(state, roomCode);
      pendingState.current = state;
      setMusicState(state);
      if (playerRef.current && playerIsReady.current) applyState(playerRef.current, state);
    }
    function onError({ message }: { message: string }) {
      setError(message);
    }
    function syncStoredMode(state: MusicState, code: string) {
      const key = `${MODE_STORAGE_PREFIX}${code}`;
      if (!modeRestored.current) {
        modeRestored.current = true;
        const stored = readStoredMode(key);
        if (stored && (stored.mode !== state.mode || stored.shuffle !== state.shuffle)) {
          socket.emit('musicSetMode', stored);
          return;
        }
      }
      try {
        localStorage.setItem(key, JSON.stringify({ mode: state.mode, shuffle: state.shuffle }));
      } catch {
        // Storage can be unavailable (private mode); the mode just is not remembered.
      }
    }
    socket.on('musicState', onMusicState);
    socket.on('error', onError);
    return () => {
      socket.off('musicState', onMusicState);
      socket.off('error', onError);
    };
  }, [socket, isAdmin, persistModes, roomCode]);

  useEffect(() => {
    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
      playerIsReady.current = false;
    };
  }, []);

  // La barra sigue al audio que suena de verdad: mientras YouTube carga no avanza. Como el player
  // se realinea con la sala al arrancar, lo que muestra coincide con lo que oye el resto.
  useEffect(() => {
    if (!musicState) {
      setPosition(0);
      return;
    }
    function tick() {
      const player = playerRef.current;
      const sounding =
        playerState.current === 1 && loadedVideoId.current === currentTrack(musicState!)?.videoId;
      if (joined && player && playerIsReady.current && musicState!.isPlaying && sounding) {
        setPosition(player.getCurrentTime());
        return;
      }
      setPosition(roomPosition(musicState!));
    }
    tick();
    if (!musicState.isPlaying) return;
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [musicState, joined]);

  function applyState(player: YT.Player, state: MusicState) {
    const newTrack = currentTrack(state)?.videoId !== loadedVideoId.current;
    reconcilePlayerState(player, loadedVideoId.current, state);
    loadedVideoId.current = currentTrack(state)?.videoId ?? null;
    setDuration(player.getDuration() || 0);
    if (state.isPlaying) {
      priming.current = false;
    } else if (newTrack && loadedVideoId.current) {
      priming.current = true;
      player.mute();
      player.playVideo();
    }
  }
  const applyStateRef = useRef(applyState);
  applyStateRef.current = applyState;

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
              playerIsReady.current = true;
              const player = playerRef.current;
              const state = pendingState.current;
              if (player && state) applyStateRef.current(player, state);
              resolve();
            },
            // getDuration() en onReady suele devolver 0: el iframe recién
            // está cargando metadata del video. onStateChange es el único
            // evento que avisa cuando ya está disponible, así que se vuelve
            // a leer ahí.
            onStateChange: (event: { data: number }) => {
              const player = playerRef.current;
              playerState.current = event.data;
              if (player) setDuration(player.getDuration() || 0);
              const state = pendingState.current;
              if (event.data === 1 && player && priming.current) {
                priming.current = false;
                if (!state?.isPlaying) {
                  player.pauseVideo();
                  if (state) player.seekTo(roomPosition(state), true);
                }
                if (!mutedRef.current) player.unMute();
                if (!state?.isPlaying) return;
              }
              // 1 = reproduciendo: recién ahora suena, así que se recupera lo que tardó en cargar.
              if (
                event.data === 1 &&
                player &&
                state &&
                currentTrack(state)?.videoId === loadedVideoId.current
              ) {
                const target = resyncTarget(state, player.getCurrentTime());
                if (target !== null) player.seekTo(target, true);
              }
              if (event.data === 0 && state?.isPlaying) {
                socketRef.current.emit('musicTrackEnded', { updatedAt: state.updatedAt });
              }
            },
            onError: () =>
              setError(tRef.current('No se pudo reproducir ese video. Probá con otro link.')),
          },
        });
      });
    })();
    return playerReady.current;
  }, []);

  const handleJoinMusic = useCallback(async () => {
    await createPlayer();
    playerRef.current?.unMute();
    setJoined(true);
  }, [createPlayer]);

  // El admin controla la música de la sala: pedirle que "se una" a su propia
  // playlist es una fricción sin sentido, así que se une solo. Para el
  // momento en que este componente es interactivo ya hubo un gesto del
  // usuario en la página (entrar a la reunión), así que unMute() desde un
  // efecto no choca con la política de autoplay con sonido del navegador.
  useEffect(() => {
    if (isAdmin) void handleJoinMusic();
  }, [isAdmin, handleJoinMusic]);

  useEffect(() => {
    if (silenced && playerIsReady.current) playerRef.current?.mute();
  }, [silenced]);

  const roomVolume = musicState?.roomVolume ?? 100;
  useEffect(() => {
    if (joined && playerIsReady.current)
      playerRef.current?.setVolume(effectiveVolume(volume, roomVolume));
  }, [joined, volume, roomVolume]);

  // Salir deja el reproductor sincronizado pero en silencio, así volver a unirse es instantáneo.
  function handleLeaveMusic() {
    playerRef.current?.mute();
    setMuted(false);
    setJoined(false);
  }

  const volumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [roomVolumeDraft, setRoomVolumeDraft] = useState<number | null>(null);
  function handleRoomVolumeChange(e: ChangeEvent<HTMLInputElement>) {
    const value = Number(e.target.value);
    setRoomVolumeDraft(value);
    clearTimeout(volumeTimer.current);
    // Un mensaje por gesto, no uno por cada paso del deslizador.
    volumeTimer.current = setTimeout(() => {
      socket.emit('musicSetVolume', { volume: value });
      setRoomVolumeDraft(null);
    }, 250);
  }
  useEffect(() => () => clearTimeout(volumeTimer.current), []);

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
    playerRef.current?.setVolume(effectiveVolume(value, roomVolume));
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

  useEffect(() => {
    const dialog = removeDialogRef.current;
    if (!dialog) return;
    if (pendingRemoval !== null && !dialog.open) dialog.showModal();
    if (pendingRemoval === null && dialog.open) dialog.close();
  }, [pendingRemoval]);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query || !roomCode || !roomToken || searching) return;
    setSearching(true);
    setSearchFailed(false);
    try {
      setSearchResults(await searchMusic(roomCode, roomToken, query));
    } catch {
      setSearchResults(null);
      setSearchFailed(true);
    } finally {
      setSearching(false);
    }
  }

  function handlePickResult(result: MusicSearchResult) {
    socket.emit('musicAddTrack', { videoId: result.videoId, title: result.title });
    setSearchResults(null);
    setSearchQuery('');
  }

  function currentPosition(): number {
    const player = playerIsReady.current ? playerRef.current : null;
    return player?.getCurrentTime() ?? musicState?.positionSeconds ?? 0;
  }

  // Quien toca ▶ arranca su reproductor ya, sin esperar la vuelta del servidor.
  function handleTogglePlay() {
    const player = playerIsReady.current ? playerRef.current : null;
    const position = currentPosition();
    if (musicState?.isPlaying) {
      player?.pauseVideo();
      socket.emit('musicPause', { positionSeconds: position });
    } else {
      priming.current = false;
      if (player && !mutedRef.current) player.unMute();
      player?.playVideo();
      socket.emit('musicPlay', { positionSeconds: position });
    }
  }

  function handlePrevious() {
    socket.emit('musicPrevious');
  }

  function handleToggleShuffle() {
    if (!musicState) return;
    socket.emit('musicSetMode', { mode: musicState.mode, shuffle: !musicState.shuffle });
  }

  function handleCycleMode() {
    if (!musicState) return;
    const next =
      PLAYBACK_MODE_ORDER[
        (PLAYBACK_MODE_ORDER.indexOf(musicState.mode) + 1) % PLAYBACK_MODE_ORDER.length
      ];
    socket.emit('musicSetMode', { mode: next, shuffle: musicState.shuffle });
  }

  function handleNext() {
    socket.emit('musicNext');
  }

  function handleRemoveTrack(index: number) {
    socket.emit('musicRemoveTrack', { index });
  }

  // Quien elige la canción la empieza a cargar ya; la vuelta del servidor la encuentra cargada.
  function handleJumpToTrack(index: number) {
    const player = playerIsReady.current ? playerRef.current : null;
    const track = musicState?.tracks[index];
    if (player && track) {
      playerState.current = -1;
      loadedVideoId.current = track.videoId;
      if (musicState?.isPlaying) {
        priming.current = false;
        player.loadVideoById(track.videoId, 0);
        if (!mutedRef.current) player.unMute();
      } else {
        // En pausa elegir otra canción no la hace sonar: solo queda precargada.
        priming.current = true;
        player.mute();
        player.loadVideoById(track.videoId, 0);
      }
    }
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
              className={styles.transportButton}
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
            <span className={styles.volumeValue} aria-hidden="true">
              {muted ? 0 : volume}%
            </span>
            {!isAdmin && (
              <button type="button" className={styles.leaveButton} onClick={handleLeaveMusic}>
                {t('Salir')}
              </button>
            )}
          </div>
        )}
        {isAdmin && musicState && musicState.tracks.length > 0 && (
          <label className={styles.roomVolumeRow}>
            <span>{t('Volumen para todos')}</span>
            <input
              type="range"
              className={styles.volumeBar}
              style={{ '--volume-fill': `${roomVolumeDraft ?? roomVolume}%` } as CSSProperties}
              min={0}
              max={100}
              value={roomVolumeDraft ?? roomVolume}
              onChange={handleRoomVolumeChange}
            />
            <span className={styles.volumeValue} aria-hidden="true">
              {roomVolumeDraft ?? roomVolume}%
            </span>
          </label>
        )}
        {isAdmin && current && musicState && (
          <div className={styles.nowPlayingBlock}>
            <div className={styles.trackArt}>
              {musicState.isPlaying ? <EqualizerBars /> : <MusicNoteIcon />}
            </div>
            <div className={styles.trackMeta}>
              <p className={styles.trackTitleMain} title={current.title}>
                {current.title}
              </p>
              <p className={styles.trackSubtitle}>
                {t('Pista')} {musicState.currentIndex + 1}/{musicState.tracks.length}
              </p>
            </div>
          </div>
        )}
        {isAdmin && current && (
          <div className={styles.seekRow}>
            <span className={styles.timeLabel}>{formatTime(displayPosition)}</span>
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
            <span className={styles.timeLabel}>{formatTime(duration)}</span>
          </div>
        )}
        {isAdmin && musicState && musicState.tracks.length > 0 && (
          <div className={styles.playbackButtons}>
            <button
              type="button"
              className={`${styles.transportButton} ${musicState.shuffle ? styles.modeActive : ''}`}
              onClick={handleToggleShuffle}
              aria-pressed={musicState.shuffle}
              title={t('Aleatorio')}
              aria-label={t('Aleatorio')}
            >
              <ShuffleIcon />
            </button>
            <button
              type="button"
              className={styles.transportButton}
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
              className={styles.transportButton}
              onClick={handleNext}
              disabled={
                musicState.shuffle || musicState.mode === 'repeat-all'
                  ? musicState.tracks.length < 2
                  : musicState.currentIndex >= musicState.tracks.length - 1
              }
              title={t('Siguiente')}
              aria-label={t('Siguiente')}
            >
              <NextIcon />
            </button>
            <button
              type="button"
              className={`${styles.transportButton} ${musicState.mode !== 'sequence' ? styles.modeActive : ''}`}
              onClick={handleCycleMode}
              title={`${t('Modo')}: ${t(PLAYBACK_MODE_LABELS[musicState.mode])}`}
              aria-label={`${t('Modo')}: ${t(PLAYBACK_MODE_LABELS[musicState.mode])}`}
            >
              <RepeatIcon mode={musicState.mode} />
            </button>
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
                {roomCode && roomToken && (
                  <div className={styles.searchBlock}>
                    <label className={styles.trackField} htmlFor="ambient-music-search">
                      {t('Buscar canción')}
                    </label>
                    <form onSubmit={(e) => void handleSearch(e)} className={styles.trackForm}>
                      <input
                        id="ambient-music-search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('Artista o canción')}
                      />
                      <button
                        type="submit"
                        className={styles.searchButton}
                        disabled={searching || !searchQuery.trim()}
                      >
                        {searching ? t('Buscando…') : t('Buscar')}
                      </button>
                    </form>
                    {searchFailed && (
                      <p className={styles.searchFallback}>
                        {t('No se pudo buscar ahora.')}{' '}
                        <a
                          href={youTubeSearchUrl(searchQuery.trim())}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t('Buscar en YouTube')}
                        </a>
                      </p>
                    )}
                    {searchResults && searchResults.length === 0 && (
                      <p className={styles.searchFallback}>{t('No hay resultados.')}</p>
                    )}
                    {searchResults && searchResults.length > 0 && (
                      <ul className={styles.searchResults}>
                        {searchResults.map((result) => (
                          <li key={result.videoId}>
                            <button
                              type="button"
                              className={styles.searchResult}
                              onClick={() => handlePickResult(result)}
                            >
                              {result.thumbnailUrl && (
                                <img src={result.thumbnailUrl} alt="" width={48} height={36} />
                              )}
                              <span className={styles.searchResultText}>
                                <span className={styles.searchResultTitle}>{result.title}</span>
                                <span className={styles.searchResultChannel}>{result.channel}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <label className={styles.trackField} htmlFor="ambient-music-track">
                  {t('Link o ID de YouTube')}
                </label>
                <form onSubmit={handleAddTrack} className={styles.trackForm}>
                  <input
                    id="ambient-music-track"
                    value={trackInput}
                    onChange={(e) => setTrackInput(e.target.value)}
                    placeholder="youtube.com/watch?v=…"
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
              </div>
            )}
            {musicState && musicState.tracks.length > 0 && (
              <>
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
                          <span className={styles.trackIndex}>
                            {isCurrent && musicState.isPlaying ? (
                              <EqualizerBars />
                            ) : (
                              String(index + 1).padStart(2, '0')
                            )}
                          </span>
                          <img
                            className={styles.trackThumb}
                            src={`https://i.ytimg.com/vi/${track.videoId}/default.jpg`}
                            alt=""
                            width={48}
                            height={36}
                            loading="lazy"
                          />
                          <span className={styles.trackTitle}>{track.title}</span>
                          <button
                            type="button"
                            className={styles.removeButton}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingRemoval(index);
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
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <dialog
        ref={removeDialogRef}
        className={styles.confirmDialog}
        onClose={() => setPendingRemoval(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setPendingRemoval(null);
        }}
      >
        {pendingRemoval !== null && musicState?.tracks[pendingRemoval] && (
          <>
            <p>
              {t('¿Quitar «{title}» de la lista?').replace(
                '{title}',
                musicState.tracks[pendingRemoval].title,
              )}
            </p>
            <div className={styles.confirmActions}>
              <button type="button" className="secondary" onClick={() => setPendingRemoval(null)}>
                {t('Cancelar')}
              </button>
              <button
                type="button"
                className={styles.confirmDangerButton}
                onClick={() => {
                  handleRemoveTrack(pendingRemoval);
                  setPendingRemoval(null);
                }}
              >
                {t('Quitar')}
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
