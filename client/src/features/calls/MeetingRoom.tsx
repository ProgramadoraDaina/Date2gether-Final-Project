'use client';

import {
  ConnectionStateToast,
  GridLayout,
  LiveKitRoom,
  MediaDeviceMenu,
  ParticipantTile,
  RoomAudioRenderer,
  StartAudio,
  useDisconnectButton,
  useTracks,
  useTrackToggle,
} from '@livekit/components-react';
import { DisconnectReason, Track, VideoPresets, type RoomOptions } from 'livekit-client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from '../translation/useTranslation';
import type { CallSessionState } from './useCallSession';
import styles from './MeetingRoom.module.css';

const options: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
  publishDefaults: {
    videoCodec: 'vp8',
    videoSimulcastLayers: [VideoPresets.h90, VideoPresets.h180],
  },
};

function MicIcon({ muted }: { muted: boolean }) {
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
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
      {muted && <line x1="4" y1="4" x2="20" y2="20" />}
    </svg>
  );
}

function CameraIcon({ off }: { off: boolean }) {
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
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
      {off && <line x1="2" y1="4" x2="22" y2="20" />}
    </svg>
  );
}

function HangUpIcon() {
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
      {/* Mismo glifo de auricular que un ícono de "llamar" estándar, pero
          rotado 135°: es la convención visual habitual para "colgar". */}
      <g transform="rotate(135 12 12)">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
      </g>
    </svg>
  );
}

function HangUpButton() {
  const { t } = useTranslation();
  const { buttonProps } = useDisconnectButton({});
  const label = t('Colgar');
  return (
    <button
      {...buttonProps}
      type="button"
      className={styles.hangUpButton}
      title={label}
      aria-label={label}
    >
      <HangUpIcon />
    </button>
  );
}

function MicToggleButton({ setDeviceError }: { setDeviceError: (value: boolean) => void }) {
  const { t } = useTranslation();
  const { buttonProps, enabled } = useTrackToggle({
    source: Track.Source.Microphone,
    onDeviceError: () => setDeviceError(true),
    onChange: () => setDeviceError(false),
  });
  const label = enabled ? t('Desactivar micrófono') : t('Activar micrófono');
  return (
    <button
      {...buttonProps}
      type="button"
      className={`${styles.iconButton} ${enabled ? styles.iconButtonActive : ''}`}
      title={label}
      aria-label={label}
    >
      <MicIcon muted={!enabled} />
    </button>
  );
}

function CameraToggleButton({ setDeviceError }: { setDeviceError: (value: boolean) => void }) {
  const { t } = useTranslation();
  const { buttonProps, enabled } = useTrackToggle({
    source: Track.Source.Camera,
    onDeviceError: () => setDeviceError(true),
    onChange: () => setDeviceError(false),
  });
  const label = enabled ? t('Desactivar cámara') : t('Activar cámara');
  return (
    <button
      {...buttonProps}
      type="button"
      className={`${styles.iconButton} ${enabled ? styles.iconButtonActive : ''}`}
      title={label}
      aria-label={label}
    >
      <CameraIcon off={!enabled} />
    </button>
  );
}

function MeetingContent() {
  const { t } = useTranslation();
  const [deviceError, setDeviceError] = useState(false);
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  return (
    <>
      <RoomAudioRenderer />
      <StartAudio label={t('Activar sonido de la reunión')} />
      <ConnectionStateToast />
      <GridLayout tracks={tracks} className={styles.meetingGrid}>
        <ParticipantTile />
      </GridLayout>
      {deviceError && (
        <p className={styles.error} role="alert">
          {t(
            'No se pudo activar el dispositivo. Revisá los permisos del navegador; podés continuar en la llamada.',
          )}
        </p>
      )}
      <div className={styles.controlsDock}>
        <div className={styles.controlsGroup}>
          <MicToggleButton setDeviceError={setDeviceError} />
          <MediaDeviceMenu
            kind="audioinput"
            requestPermissions={false}
            aria-label={t('Elegir micrófono')}
          />
          <CameraToggleButton setDeviceError={setDeviceError} />
          <MediaDeviceMenu
            kind="videoinput"
            requestPermissions={false}
            aria-label={t('Elegir cámara')}
          />
        </div>
        <HangUpButton />
      </div>
    </>
  );
}

export default function MeetingRoom({ call }: { call: CallSessionState }) {
  const router = useRouter();
  if (!call.session) return null;
  return (
    <LiveKitRoom
      token={call.session.token}
      serverUrl={call.session.url}
      connect
      audio={false}
      video={false}
      options={options}
      onConnected={call.connected}
      onError={call.failed}
      onDisconnected={(reason) => {
        if (reason === undefined || reason === DisconnectReason.CLIENT_INITIATED) {
          call.leaveCall();
          router.push('/');
        } else call.failed(new Error('Disconnected'));
      }}
      data-lk-theme="default"
      className={styles.meetingRoom}
    >
      <MeetingContent />
    </LiveKitRoom>
  );
}
