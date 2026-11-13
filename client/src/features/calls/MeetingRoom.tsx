'use client';

import {
  ConnectionStateToast,
  GridLayout,
  LiveKitRoom,
  MediaDeviceMenu,
  RoomAudioRenderer,
  StartAudio,
  useDisconnectButton,
  useRoomContext,
  useTracks,
  useTrackToggle,
} from '@livekit/components-react';
import {
  ConnectionState,
  RoomEvent,
  DefaultReconnectPolicy,
  DisconnectReason,
  Track,
  VideoPresets,
  type RoomOptions,
} from 'livekit-client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CALL_DEVICES, type CallDevices } from './callDevices';
import type { RoomEmoji } from '@/lib/api';
import { useTranslation } from '../translation/useTranslation';
import type { CallSessionState } from './useCallSession';
import styles from './MeetingRoom.module.css';
import { ReactionOverlay } from './reactions/ReactionOverlay';
import { ReactionPicker } from './reactions/ReactionPicker';
import { SoundboardPicker } from './reactions/SoundboardPicker';
import { ReactionsProvider } from './reactions/ReactionsProvider';
import { ReactionTile } from './reactions/ReactionTile';

const options: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
  publishDefaults: {
    videoCodec: 'vp8',
    videoSimulcastLayers: [VideoPresets.h90, VideoPresets.h180],
  },
  // La política por defecto de livekit-client hace 10 reintentos (con
  // delays que suman más de 40s entre sí, sin contar cada intento real de
  // conexión): si la red no deja pasar WebRTC, la llamada queda reintentando
  // en silencio por minutos antes de avisar el error. Con pocos intentos
  // cortos, alguien con un corte breve de red sigue reconectando solo, pero
  // una falla sostenida llega rápido a la pantalla de "Reintentar".
  reconnectPolicy: new DefaultReconnectPolicy([0, 500]),
};

// Los tests e2e simulan LiveKit por completo (no hacen una conexión WebRTC
// real, ver e2e/README.md), así que este valor no está acotado por ningún
// timeout de test. 5s era insuficiente para la primera negociación ICE real
// (ej. latencia extra del reenvío de puertos UDP de Docker Desktop en
// Windows); se vuelve al default de livekit-client.
const connectOptions = { peerConnectionTimeout: 15000 };

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

function ScreenShareIcon() {
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
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
      <path d="M9 11l3-3 3 3" />
      <path d="M12 8v4" />
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
      {/* Auricular de "llamar" rotado 135° (convención de colgar), achicado para no recortar las puntas. */}
      <g transform="translate(12 12) rotate(135) scale(0.78) translate(-12 -12)">
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

function ScreenShareToggleButton({ setDeviceError }: { setDeviceError: (value: boolean) => void }) {
  const { t } = useTranslation();
  const { buttonProps, enabled } = useTrackToggle({
    source: Track.Source.ScreenShare,
    captureOptions: { audio: true },
    onDeviceError: () => setDeviceError(true),
    onChange: () => setDeviceError(false),
  });
  const label = enabled ? t('Dejar de compartir pantalla') : t('Compartir pantalla');
  return (
    <button
      {...buttonProps}
      type="button"
      className={`${styles.iconButton} ${enabled ? styles.iconButtonActive : ''}`}
      title={label}
      aria-label={label}
    >
      <ScreenShareIcon />
    </button>
  );
}

interface MeetingRoomProps {
  call: CallSessionState;
  roomCode: string;
  roomEmojis: RoomEmoji[];
  initialDevices?: CallDevices;
}

// Un permiso revocado después del lobby no debe hacer fallar la llamada.
// Solo se aplica al conectar por primera vez; reconectar conserva los estados.
function InitialCallDevices({
  devices,
  onDeviceError,
}: {
  devices: CallDevices;
  onDeviceError(): void;
}) {
  const room = useRoomContext();
  const appliedTo = useRef<typeof room | null>(null);
  useEffect(() => {
    const publish = () => {
      if (appliedTo.current === room) return;
      appliedTo.current = room;
      if (devices.microphoneEnabled)
        void room.localParticipant.setMicrophoneEnabled(true).catch(onDeviceError);
      if (devices.cameraEnabled)
        void room.localParticipant.setCameraEnabled(true).catch(onDeviceError);
    };
    room.on(RoomEvent.Connected, publish);
    if (room.state === ConnectionState.Connected) publish();
    return () => {
      room.off(RoomEvent.Connected, publish);
    };
  }, [room, devices, onDeviceError]);
  return null;
}

function MeetingContent({
  roomCode,
  roomEmojis,
  initialDevices = DEFAULT_CALL_DEVICES,
}: Omit<MeetingRoomProps, 'call'>) {
  const { t } = useTranslation();
  const [deviceError, setDeviceError] = useState(false);
  const showDeviceError = useCallback(() => setDeviceError(true), []);
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <ReactionsProvider roomCode={roomCode} roomEmojis={roomEmojis}>
      <InitialCallDevices devices={initialDevices} onDeviceError={showDeviceError} />
      <RoomAudioRenderer />
      <StartAudio label={t('Activar sonido de la reunión')} />
      <ConnectionStateToast />
      <GridLayout tracks={tracks} className={styles.meetingGrid}>
        <ReactionTile />
      </GridLayout>
      <ReactionOverlay />
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
          <ScreenShareToggleButton setDeviceError={setDeviceError} />
          <ReactionPicker buttonClassName={styles.iconButton} />
          <SoundboardPicker buttonClassName={styles.iconButton} />
        </div>
        <HangUpButton />
      </div>
    </ReactionsProvider>
  );
}

export default function MeetingRoom({
  call,
  roomCode,
  roomEmojis,
  initialDevices = DEFAULT_CALL_DEVICES,
}: MeetingRoomProps) {
  const router = useRouter();
  const roomOptions = useMemo(
    () => ({
      ...options,
      audioCaptureDefaults: { deviceId: initialDevices.microphoneId || undefined },
      videoCaptureDefaults: {
        ...options.videoCaptureDefaults,
        deviceId: initialDevices.cameraId || undefined,
      },
    }),
    [initialDevices.microphoneId, initialDevices.cameraId],
  );
  if (!call.session) return null;
  return (
    <LiveKitRoom
      token={call.session.token}
      serverUrl={call.session.url}
      connect
      audio={false}
      video={false}
      options={roomOptions}
      connectOptions={connectOptions}
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
      <MeetingContent
        roomCode={roomCode}
        roomEmojis={roomEmojis}
        initialDevices={initialDevices}
      />
    </LiveKitRoom>
  );
}
