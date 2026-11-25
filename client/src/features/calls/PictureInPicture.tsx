'use client';

import {
  useLocalParticipant,
  useSpeakingParticipants,
  useTracks,
  VideoTrack,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../translation/useTranslation';
import { useParticipantColor } from './participantColors';
import { avatarIdentityOf } from '@/features/avatar/TileAvatar';
import styles from './PictureInPicture.module.css';

interface DocumentPictureInPicture {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

const pipApi = () =>
  (window as Window & { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture;
const subscribe = () => () => {};
const MAX_TILES = 4;

// La ventana nueva no hereda estilos: se copian las hojas de la página (las de otro origen, por link).
function copyStyles(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.createElement('style');
      style.textContent = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n');
      target.head.appendChild(style);
    } catch {
      if (!sheet.href) continue;
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      target.head.appendChild(link);
    }
  }
  // next/font define las variables de fuente con clases en <html> y <body>.
  target.documentElement.className = document.documentElement.className;
  target.body.className = document.body.className;
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme) target.documentElement.setAttribute('data-theme', theme);
  target.documentElement.lang = document.documentElement.lang;
}

function PipTile({
  trackRef,
  speaking,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  speaking: boolean;
}) {
  const color = useParticipantColor(avatarIdentityOf(trackRef.participant));
  const name = trackRef.participant.name || trackRef.participant.identity;
  const hasVideo = !!trackRef.publication?.track && !trackRef.publication.isMuted;
  return (
    <div
      className={styles.tile}
      data-speaking={speaking}
      style={{ '--speaker-color': color } as CSSProperties}
    >
      {hasVideo ? (
        <VideoTrack trackRef={trackRef as TrackReference} />
      ) : (
        <span className={styles.initial} style={{ background: color }}>
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className={styles.name}>{name}</span>
    </div>
  );
}

function PipView() {
  const { t } = useTranslation();
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const speaking = useSpeakingParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const speakingIds = new Set(speaking.map((participant) => participant.identity));
  // Quien habla primero, así la ventana chica muestra lo que importa.
  const shown = [...tracks]
    .sort(
      (a, b) =>
        Number(speakingIds.has(b.participant.identity)) -
        Number(speakingIds.has(a.participant.identity)),
    )
    .slice(0, MAX_TILES);
  return (
    <div className={styles.view}>
      <div className={styles.grid} data-count={shown.length}>
        {shown.map((trackRef) => (
          <PipTile
            key={trackRef.participant.identity}
            trackRef={trackRef}
            speaking={speakingIds.has(trackRef.participant.identity)}
          />
        ))}
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={isMicrophoneEnabled ? styles.on : styles.off}
          onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        >
          {t(isMicrophoneEnabled ? 'Desactivar micrófono' : 'Activar micrófono')}
        </button>
        <button
          type="button"
          className={isCameraEnabled ? styles.on : styles.off}
          onClick={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}
        >
          {t(isCameraEnabled ? 'Desactivar cámara' : 'Activar cámara')}
        </button>
      </div>
    </div>
  );
}

function PipIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="16" rx="1" />
      <rect x="12" y="12" width="8" height="6" />
    </svg>
  );
}

export function PictureInPictureButton({
  buttonClassName,
  activeClassName,
}: {
  buttonClassName: string;
  activeClassName: string;
}) {
  const { t } = useTranslation();
  const supported = useSyncExternalStore(
    subscribe,
    () => !!pipApi(),
    () => false,
  );
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  useEffect(() => {
    if (!pipWindow) return;
    const closed = () => setPipWindow(null);
    pipWindow.addEventListener('pagehide', closed);
    return () => {
      pipWindow.removeEventListener('pagehide', closed);
      pipWindow.close();
    };
  }, [pipWindow]);
  if (!supported) return null;
  const label = t(pipWindow ? 'Cerrar ventana flotante' : 'Abrir ventana flotante');
  return (
    <>
      <button
        type="button"
        className={`${buttonClassName} ${pipWindow ? activeClassName : ''}`}
        aria-pressed={!!pipWindow}
        title={label}
        aria-label={label}
        onClick={() => {
          if (pipWindow) {
            setPipWindow(null);
            return;
          }
          void pipApi()
            ?.requestWindow({ width: 360, height: 260 })
            .then((opened) => {
              copyStyles(opened.document);
              opened.document.title = 'Date2gether';
              setPipWindow(opened);
            })
            .catch(() => undefined);
        }}
      >
        <PipIcon />
      </button>
      {pipWindow && createPortal(<PipView />, pipWindow.document.body)}
    </>
  );
}
