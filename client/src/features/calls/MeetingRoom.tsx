'use client';

import {
  CarouselLayout,
  ConnectionStateToast,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  MediaDeviceMenu,
  RoomAudioRenderer,
  StartAudio,
  TrackRefContext,
  useCreateLayoutContext,
  useDisconnectButton,
  usePinnedTracks,
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
import { HangUpButton } from './HangUpButton';
import type { RoomEmoji } from '@/lib/api';
import { useTranslation } from '../translation/useTranslation';
import { reportTrackState } from '@/lib/calls';
import type { CallSessionState } from './useCallSession';
import styles from './MeetingRoom.module.css';
import { ReactionOverlay } from './reactions/ReactionOverlay';
import { ReactionPicker } from './reactions/ReactionPicker';
import { SoundboardPicker } from './reactions/SoundboardPicker';
import { ReactionsProvider } from './reactions/ReactionsProvider';
import { ReactionTile } from './reactions/ReactionTile';
import { CallSettingsButton } from './settings/CallSettings';
import { useCallSettingsStore } from './settings/store';
import { CaptionsButton, CaptionsOverlay } from './transcription/Captions';
import { TranscriptionProvider } from './transcription/TranscriptionProvider';

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

// Dentro de la llamada ya conectada, "colgar" significa desconectar de
// LiveKit. La pantalla de conectando/error (RoomPage) reusa el mismo
// HangUpButton con un onConfirm distinto (ver comentario ahí) — el diálogo
// de confirmación es compartido, ver HangUpButton.tsx.
function ConnectedHangUpButton() {
  const { buttonProps } = useDisconnectButton({});
  return <HangUpButton onConfirm={buttonProps.onClick} />;
}

interface ToggleButtonProps {
  roomCode: string;
  roomToken: string;
  setDeviceError: (value: boolean) => void;
}

function MicToggleButton({ roomCode, roomToken, setDeviceError }: ToggleButtonProps) {
  const { t } = useTranslation();
  // useTrackToggle sincroniza `onChange` con un useEffect propio que depende
  // de [enabled, onChange] (ver livekit-client/components-react): una
  // función nueva en cada render reengancha ese efecto en cada render, no
  // solo cuando `enabled` realmente cambia. Sin useCallback acá, un mic
  // encendido 15s mandaba ~25 reportes de "desmuteado" repetidos — cada uno
  // pisando el intervalo real como si fuera un prendido nuevo.
  const onMicChange = useCallback(
    (isEnabled: boolean) => {
      setDeviceError(false);
      void reportTrackState(roomCode, roomToken, 'microphone', isEnabled);
    },
    [roomCode, roomToken, setDeviceError],
  );
  const { buttonProps, enabled } = useTrackToggle({
    source: Track.Source.Microphone,
    onDeviceError: () => setDeviceError(true),
    onChange: onMicChange,
  });
  const remember = useCallSettingsStore((state) => state.setDeviceEnabled);
  const label = enabled ? t('Desactivar micrófono') : t('Activar micrófono');
  return (
    <button
      {...buttonProps}
      onClick={(event) => {
        buttonProps.onClick?.(event);
        remember('microphone', !enabled);
      }}
      type="button"
      className={`${styles.iconButton} ${enabled ? styles.iconButtonActive : ''}`}
      title={label}
      aria-label={label}
    >
      <MicIcon muted={!enabled} />
    </button>
  );
}

function CameraToggleButton({ roomCode, roomToken, setDeviceError }: ToggleButtonProps) {
  const { t } = useTranslation();
  // Mismo motivo que en MicToggleButton: onChange tiene que ser estable.
  const onCameraChange = useCallback(
    (isEnabled: boolean) => {
      setDeviceError(false);
      void reportTrackState(roomCode, roomToken, 'camera', isEnabled);
    },
    [roomCode, roomToken, setDeviceError],
  );
  const { buttonProps, enabled } = useTrackToggle({
    source: Track.Source.Camera,
    onDeviceError: () => setDeviceError(true),
    onChange: onCameraChange,
  });
  const remember = useCallSettingsStore((state) => state.setDeviceEnabled);
  const label = enabled ? t('Desactivar cámara') : t('Activar cámara');
  return (
    <button
      {...buttonProps}
      onClick={(event) => {
        buttonProps.onClick?.(event);
        remember('camera', !enabled);
      }}
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
  roomToken: string;
  roomEmojis: RoomEmoji[];
  initialDevices?: CallDevices;
  onTranscriptAvailable?: (callSid: string) => void;
  // Reemplaza la vuelta al inicio al colgar (por ejemplo, para mostrar el acta).
  onHangUp?: () => void;
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
  roomToken,
  roomEmojis,
  initialDevices = DEFAULT_CALL_DEVICES,
  onTranscriptAvailable,
}: Omit<MeetingRoomProps, 'call' | 'onHangUp'>) {
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
  // Clickear el botón de foco de un .tileWrap (ver ReactionTile) pinea ese
  // trackRef acá. Mientras haya uno pineado, la grilla pareja se
  // reemplaza por foco + carrusel (a lo Zoom/Meet); sin nada pineado,
  // vuelve a la grilla normal. El contexto se crea y se provee una sola
  // vez, no por cada tile — así todos los tiles leen el mismo pin.
  const layoutContext = useCreateLayoutContext();
  const pinnedTracks = usePinnedTracks(layoutContext);
  const focusTrack = pinnedTracks[0];
  const carouselTracks = focusTrack
    ? tracks.filter(
        (track) =>
          !(
            track.participant.identity === focusTrack.participant.identity &&
            track.source === focusTrack.source
          ),
      )
    : tracks;
  return (
    <ReactionsProvider roomCode={roomCode} roomEmojis={roomEmojis}>
      <TranscriptionProvider
        roomCode={roomCode}
        roomToken={roomToken}
        onTranscriptAvailable={onTranscriptAvailable}
      >
        <LayoutContextProvider value={layoutContext}>
          <InitialCallDevices devices={initialDevices} onDeviceError={showDeviceError} />
          <RoomAudioRenderer />
          <StartAudio label={t('Activar sonido de la reunión')} />
          <ConnectionStateToast />
          {focusTrack ? (
            <FocusLayoutContainer className={styles.meetingGrid}>
              <CarouselLayout tracks={carouselTracks}>
                <ReactionTile canFocus={tracks.length > 1} />
              </CarouselLayout>
              <TrackRefContext.Provider value={focusTrack}>
                <ReactionTile canFocus={tracks.length > 1} />
              </TrackRefContext.Provider>
            </FocusLayoutContainer>
          ) : (
            <GridLayout tracks={tracks} className={styles.meetingGrid}>
              <ReactionTile canFocus={tracks.length > 1} />
            </GridLayout>
          )}
          <ReactionOverlay />
          <CaptionsOverlay />
          {deviceError && (
            <p className={styles.error} role="alert">
              {t(
                'No se pudo activar el dispositivo. Revisá los permisos del navegador; podés continuar en la llamada.',
              )}
            </p>
          )}
          <div className={styles.controlsDock}>
            <div className={styles.controlsGroup}>
              <MicToggleButton
                roomCode={roomCode}
                roomToken={roomToken}
                setDeviceError={setDeviceError}
              />
              <MediaDeviceMenu
                kind="audioinput"
                requestPermissions={false}
                aria-label={t('Elegir micrófono')}
              />
              <CameraToggleButton
                roomCode={roomCode}
                roomToken={roomToken}
                setDeviceError={setDeviceError}
              />
              <MediaDeviceMenu
                kind="videoinput"
                requestPermissions={false}
                aria-label={t('Elegir cámara')}
              />
              <ScreenShareToggleButton setDeviceError={setDeviceError} />
              <ReactionPicker buttonClassName={styles.iconButton} />
              <SoundboardPicker buttonClassName={styles.iconButton} />
              <CaptionsButton
                buttonClassName={styles.iconButton}
                activeClassName={styles.iconButtonActive}
              />
            </div>
            <CallSettingsButton buttonClassName={styles.iconButton} />
            <ConnectedHangUpButton />
          </div>
        </LayoutContextProvider>
      </TranscriptionProvider>
    </ReactionsProvider>
  );
}

export default function MeetingRoom({
  call,
  roomCode,
  roomToken,
  roomEmojis,
  initialDevices = DEFAULT_CALL_DEVICES,
  onTranscriptAvailable,
  onHangUp,
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
          if (onHangUp) onHangUp();
          else router.push('/');
        } else if (
          // Cierre forzado por el anfitrión (D5, design.md): LiveKit
          // reporta ROOM_DELETED cuando se llamó a RoomService.DeleteRoom
          // (nuestro cierre forzado) y ROOM_CLOSED cuando LiveKit cierra la
          // sala por su cuenta. Ninguno de los dos es un error de red.
          reason === DisconnectReason.ROOM_DELETED ||
          reason === DisconnectReason.ROOM_CLOSED
        ) {
          call.endedByHost();
        } else call.failed(new Error('Disconnected'));
      }}
      data-lk-theme="default"
      className={styles.meetingRoom}
    >
      <MeetingContent
        roomCode={roomCode}
        roomToken={roomToken}
        roomEmojis={roomEmojis}
        initialDevices={initialDevices}
        onTranscriptAvailable={onTranscriptAvailable}
      />
    </LiveKitRoom>
  );
}
