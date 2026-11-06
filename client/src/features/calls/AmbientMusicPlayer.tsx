'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Socket } from 'socket.io-client';
import { useTranslation } from '../translation/useTranslation';
import { reconcilePlayerState, type MusicState } from './ambientMusic';
import styles from './AmbientMusicPlayer.module.css';

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
  const [trackInput, setTrackInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const loadedVideoId = useRef<string | null>(null);
  const pendingState = useRef<MusicState | null>(null);

  useEffect(() => {
    function onMusicState(state: MusicState) {
      pendingState.current = state;
      setMusicState(state);
      if (playerRef.current) {
        reconcilePlayerState(playerRef.current, loadedVideoId.current, state);
        loadedVideoId.current = state.videoId;
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

  const createPlayer = useCallback(async () => {
    if (playerRef.current) return;
    await loadYouTubeApi();
    playerRef.current = new window.YT!.Player(PLAYER_ELEMENT_ID, {
      height: '1',
      width: '1',
      events: {
        onReady: () => {
          const player = playerRef.current;
          const state = pendingState.current;
          if (player && state) {
            reconcilePlayerState(player, loadedVideoId.current, state);
            loadedVideoId.current = state.videoId;
          }
        },
        onError: () => setError(t('No se pudo reproducir ese video. Probá con otro link.')),
      },
    });
  }, [t]);

  async function handleJoinMusic() {
    await createPlayer();
    playerRef.current?.unMute();
    setJoined(true);
  }

  function handleSetTrack(e: FormEvent) {
    e.preventDefault();
    const videoId = trackInput.trim();
    if (!videoId) return;
    socket.emit('musicSetTrack', { videoId });
    setTrackInput('');
  }

  function currentPosition(): number {
    return playerRef.current?.getCurrentTime() ?? musicState?.positionSeconds ?? 0;
  }

  function handlePlay() {
    socket.emit('musicPlay', { positionSeconds: currentPosition() });
  }

  function handlePause() {
    socket.emit('musicPause', { positionSeconds: currentPosition() });
  }

  return (
    <div className={styles.ambientMusic}>
      <div id={PLAYER_ELEMENT_ID} className={styles.hiddenPlayer} />
      {!joined && (
        <button type="button" onClick={handleJoinMusic}>
          {t('Unirme a la música')}
        </button>
      )}
      {isAdmin && (
        <form onSubmit={handleSetTrack} className={styles.adminControls}>
          <input
            value={trackInput}
            onChange={(e) => setTrackInput(e.target.value)}
            placeholder={t('Pegá un link o ID de YouTube')}
          />
          <button type="submit">{t('Elegir canción')}</button>
          <button type="button" onClick={handlePlay} disabled={!musicState}>
            {t('Reproducir')}
          </button>
          <button type="button" onClick={handlePause} disabled={!musicState}>
            {t('Pausar')}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
