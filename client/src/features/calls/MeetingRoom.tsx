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
import type { Socket } from 'socket.io-client';
import { DEFAULT_CALL_DEVICES, type CallDevices } from './callDevices';
import { HangUpButton } from './HangUpButton';
import { findMentionedParticipant } from './nameFocus';
import type { RoomEmoji } from '@/lib/api';
import { useTranslation } from '../translation/useTranslation';
import { reportTrackState, startCall } from '@/lib/calls';
import { isAdminBreakoutView, issueBreakoutToken, listBreakoutRooms } from '@/lib/breakouts';
import type { CallSessionState } from './useCallSession';
import styles from './MeetingRoom.module.css';
import { useRoomSocket } from '../chat/useRoomSocket';
import { BreakoutView } from './BreakoutView';
import { BreakoutTransition, type BreakoutTransitionState } from './BreakoutTransition';
import { BreakoutToasts } from './BreakoutToasts';
import type { BreakoutHostConsoleParticipant } from './BreakoutHostConsole';
import { ReactionOverlay } from './reactions/ReactionOverlay';
import { ReactionPicker } from './reactions/ReactionPicker';
import { SoundboardPicker } from './reactions/SoundboardPicker';
import { ReactionsProvider } from './reactions/ReactionsProvider';
import { ReactionTile } from './reactions/ReactionTile';
import { CallSettingsButton } from './settings/CallSettings';
import { useCallSettingsStore } from './settings/store';
import { CustomCallLayout } from './layout/CustomCallLayout';
import { useCallLayoutStore } from './layout/store';
import { CaptionsButton, CaptionsOverlay } from './transcription/Captions';
import { TranscriptionProvider } from './transcription/TranscriptionProvider';
import { MutedNudge } from './MutedNudge';
import { CallShortcuts } from './CallShortcuts';
import { usePictureInPicture } from './PictureInPicture';
import { audioProcessing, CallPreferenceEffects } from './CallPreferenceEffects';
import { HandsProvider } from './hands/HandsProvider';
import { HandButton, HandQueue } from './hands/HandControls';
import { ParticipantColorsContext, type ParticipantColors } from './participantColors';

const TRANSITION_TIMEOUT_MS = 12_000;
const NO_COLORS: ParticipantColors = {};

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
  // Bloqueo forzado por el admin de la sala (mutear/apagar cámara a todos):
  // mientras esté activo, esta persona no puede volver a prender el
  // dispositivo por su cuenta (ver useRoomMediaLock.ts).
  locked: boolean;
}

function MicToggleButton({ roomCode, roomToken, setDeviceError, locked }: ToggleButtonProps) {
  const { t } = useTranslation();
  const room = useRoomContext();
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
  // Si el admin activa el mute global mientras esta persona ya estaba con el
  // mic prendido, se lo apaga en el momento (no espera a que vuelva a tocar
  // el botón).
  useEffect(() => {
    if (locked && enabled) void room.localParticipant.setMicrophoneEnabled(false);
  }, [locked, enabled, room]);
  const remember = useCallSettingsStore((state) => state.setDeviceEnabled);
  const label = enabled ? t('Desactivar micrófono') : t('Activar micrófono');
  return (
    <button
      {...buttonProps}
      onClick={(event) => {
        if (locked) return;
        buttonProps.onClick?.(event);
        remember('microphone', !enabled);
      }}
      type="button"
      disabled={locked}
      className={`${styles.iconButton} ${enabled ? styles.iconButtonActive : styles.iconButtonMuted}`}
      title={label}
      aria-label={label}
    >
      <MicIcon muted={!enabled} />
    </button>
  );
}

function CameraToggleButton({ roomCode, roomToken, setDeviceError, locked }: ToggleButtonProps) {
  const { t } = useTranslation();
  const room = useRoomContext();
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
  useEffect(() => {
    if (locked && enabled) void room.localParticipant.setCameraEnabled(false);
  }, [locked, enabled, room]);
  const remember = useCallSettingsStore((state) => state.setDeviceEnabled);
  const label = enabled ? t('Desactivar cámara') : t('Activar cámara');
  return (
    <button
      {...buttonProps}
      onClick={(event) => {
        if (locked) return;
        buttonProps.onClick?.(event);
        remember('camera', !enabled);
      }}
      type="button"
      disabled={locked}
      className={`${styles.iconButton} ${enabled ? styles.iconButtonActive : styles.iconButtonMuted}`}
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
  // Mutear/apagar cámara a todos (ver useRoomMediaLock.ts): el admin nunca
  // se autosilencia, por eso MeetingContent recalcula el bloqueo aplicado
  // por dispositivo en vez de usar estos valores crudos directamente.
  isCurrentUserAdmin: boolean;
  audioLocked: boolean;
  videoLocked: boolean;
  onSetAudioLock: (locked: boolean) => void;
  onSetVideoLock: (locked: boolean) => void;
  // Mini salas (breakout-rooms, Fase 6.12 — montaje real en la UI). Gente
  // conectada a la sala principal elegible para trasladar: el identity de
  // LiveKit de cada fila es el mismo `participant.sub` que arma el gate de
  // host-gate (ver RoomPresence.participantId en page.tsx), no uno inventado
  // acá. Opcional con default vacío para no romper los render() existentes
  // de MeetingRoom.spec.tsx que todavía no pasan esta prop.
  participants?: BreakoutHostConsoleParticipant[];
  // Color de nombre por identity, para el borde de quien habla y la fila de manos.
  participantColors?: ParticipantColors;
  // Socket de sala ya conectado (o null mientras conecta): se lo pasa tal
  // cual a useRoomSocket para escuchar breakout:assigned/breakout:closed,
  // mismo patrón que useRoomMediaLock/useRoomEvents en page.tsx.
  roomSocket?: Socket | null;
  // Decisión 5 (design.md): identity propia para BreakoutView -- filtra la
  // fila del admin del selector genérico de traslado y habilita el
  // auto-traslado explícito. Mismo patrón que PollPanel (page.tsx:951).
  currentParticipantId?: string;
  // Enfocar automáticamente el video de quien es nombrado en voz (ver
  // nameFocus.ts): activable/desactivable solo por el admin, sincronizado a
  // toda la sala por el mismo gateway que mediaLock (ver useNameFocusSetting).
  nameFocusEnabled: boolean;
  onSetNameFocus: (enabled: boolean) => void;
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
  isCurrentUserAdmin,
  audioLocked,
  videoLocked,
  onSetAudioLock,
  onSetVideoLock,
  participants = [],
  currentParticipantId = '',
  breakoutAssignment,
  switchRoom,
  nameFocusEnabled,
  onSetNameFocus,
}: Omit<MeetingRoomProps, 'call' | 'onHangUp' | 'roomSocket'> & {
  // Mini salas (breakout-rooms, Fase 6.13): traslado REAL de medios al
  // recibir breakout:assigned. Se pasa solo esta función de `call` (no el
  // objeto `call` entero, excluido arriba) porque es lo único que este
  // componente necesita para ejecutar el Flujo 1 de design.md -- pedir el
  // token y reemplazar la sesión de forma atómica, nunca vía joinCall.
  switchRoom: CallSessionState['switchRoom'];
  // Decisión 2 (design.md): useRoomSocket ahora se llama UNA sola vez, en
  // el componente exterior (MeetingRoom), porque consumeRemovalNotice se
  // necesita en el ámbito de onDisconnected, no acá. breakoutAssignment
  // llega ya resuelto como prop en vez de llamar al hook otra vez --
  // llamarlo dos veces sobre el mismo socket es seguro en producción
  // (Socket.io admite múltiples listeners), pero duplica trabajo sin
  // necesidad.
  breakoutAssignment: ReturnType<typeof useRoomSocket>['breakoutAssignment'];
}) {
  const { t } = useTranslation();
  const [deviceError, setDeviceError] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const pictureInPicture = usePictureInPicture();
  const showDeviceError = useCallback(() => setDeviceError(true), []);
  // Traslado real de medios (Fase 6.13, Flujo 1 de design.md): pide el token
  // de la mini sala y reemplaza la sesión con switchRoom -- nunca joinCall,
  // cuya guarda `if (pending.current || current.current) return;` aborta
  // cualquier traslado porque ya hay una sesión en curso (mismo motivo que
  // 6.2/6.3 de useCallSession). `breakoutSwitchHandled` evita repetir el
  // pedido para la MISMA asignación en renders sucesivos (useRoomSocket
  // entrega un objeto nuevo en cada evento, incluso si el id no cambió) y,
  // junto con el chequeo dentro de la promesa, descarta una resolución
  // atrasada de un pedido viejo si mientras tanto llegó una reasignación: el
  // id más reciente siempre gana, sin un switchRoom intermedio inconsistente.
  const breakoutSwitchHandled = useRef<string | null>(null);
  const [breakoutSwitchError, setBreakoutSwitchError] = useState<string | null>(null);
  useEffect(() => {
    if (!breakoutAssignment) return;
    if (breakoutSwitchHandled.current === breakoutAssignment.breakoutId) return;
    if (breakoutAssignment.alreadyInRoom) {
      breakoutSwitchHandled.current = breakoutAssignment.breakoutId;
      return;
    }
    const requestedId = breakoutAssignment.breakoutId;
    breakoutSwitchHandled.current = requestedId;
    setBreakoutSwitchError(null);
    issueBreakoutToken(roomCode, roomToken, requestedId)
      .then((token) => {
        if (breakoutSwitchHandled.current !== requestedId) return;
        switchRoom(token);
      })
      .catch((cause) => {
        if (breakoutSwitchHandled.current !== requestedId) return;
        setBreakoutSwitchError(
          cause instanceof Error ? cause.message : t('No se pudo entrar a la mini sala'),
        );
      });
  }, [breakoutAssignment, roomCode, roomToken, switchRoom, t]);
  // El admin nunca se autosilencia: el lock que ve y controla en el panel es
  // el crudo (audioLocked/videoLocked), pero el que efectivamente se aplica a
  // sus propios botones de mic/cámara descarta ese caso.
  const enforceAudioLock = audioLocked && !isCurrentUserAdmin;
  const enforceVideoLock = videoLocked && !isCurrentUserAdmin;
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
  const customLayout = useCallLayoutStore();
  useEffect(() => {
    useCallLayoutStore.getState().applyDefaultPreset();
  }, []);
  const useCustomLayout = customLayout.enabled && customLayout.zones.length > 0;
  // Misma frase final de transcripción llega a todas las pantallas por el
  // data channel que ya usa TranscriptionProvider (ver TRANSCRIPT_TOPIC): al
  // correr este mismo matching en cada cliente, el pineo termina viéndose
  // igual en todos sin necesidad de un mensaje de foco aparte.
  const cameraTracks = useMemo(
    () => tracks.filter((track) => track.source === Track.Source.Camera),
    [tracks],
  );
  const handleFinalPhrase = useCallback(
    (phrase: { identity: string; name: string; text: string }) => {
      if (!nameFocusEnabled) return;
      const match = findMentionedParticipant(phrase.text, cameraTracks, phrase.identity);
      if (match) layoutContext?.pin.dispatch?.({ msg: 'set_pin', trackReference: match });
    },
    [nameFocusEnabled, cameraTracks, layoutContext],
  );
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
      <HandsProvider>
        <TranscriptionProvider
          roomCode={roomCode}
          roomToken={roomToken}
          onTranscriptAvailable={onTranscriptAvailable}
          onFinalPhrase={handleFinalPhrase}
        >
          <LayoutContextProvider value={layoutContext}>
            <InitialCallDevices devices={initialDevices} onDeviceError={showDeviceError} />
            <CallPreferenceEffects />
            <RoomAudioRenderer />
            <StartAudio label={t('Activar sonido de la reunión')} />
            <ConnectionStateToast />
            {breakoutSwitchError && (
              <p className={styles.error} role="alert">
                {breakoutSwitchError}
              </p>
            )}
            {focusTrack ? (
              <FocusLayoutContainer className={styles.meetingGrid}>
                {/* Remount per focus: LiveKit's stable ordering throws when reused across focus changes. */}
                <CarouselLayout
                  key={`${focusTrack.participant.identity}-${focusTrack.source}`}
                  tracks={carouselTracks}
                >
                  <ReactionTile canFocus={tracks.length > 1} />
                </CarouselLayout>
                <TrackRefContext.Provider value={focusTrack}>
                  <ReactionTile canFocus={tracks.length > 1} />
                </TrackRefContext.Provider>
              </FocusLayoutContainer>
            ) : useCustomLayout ? (
              <CustomCallLayout
                tracks={tracks}
                zones={customLayout.zones}
                editing={customLayout.editing}
              />
            ) : (
              <GridLayout tracks={tracks} className={styles.meetingGrid}>
                <ReactionTile canFocus={tracks.length > 1} />
              </GridLayout>
            )}
            <ReactionOverlay />
            <HandQueue isAdmin={isCurrentUserAdmin} />
            <MutedNudge locked={enforceAudioLock} />
            {pictureInPicture.portal}
            <CallShortcuts
              audioLocked={enforceAudioLock}
              videoLocked={enforceVideoLock}
              helpOpen={shortcutsOpen}
              onHelpOpenChange={setShortcutsOpen}
            />
            <CaptionsOverlay />
            {deviceError && (
              <p className={styles.error} role="alert">
                {t(
                  'No se pudo activar el dispositivo. Revisá los permisos del navegador; podés continuar en la llamada.',
                )}
              </p>
            )}
            <div className={styles.controlsDock}>
              <div
                className={styles.controlsGroup}
                role="group"
                aria-label={t('Micrófono y cámara')}
              >
                <MicToggleButton
                  roomCode={roomCode}
                  roomToken={roomToken}
                  setDeviceError={setDeviceError}
                  locked={enforceAudioLock}
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
                  locked={enforceVideoLock}
                />
                <MediaDeviceMenu
                  kind="videoinput"
                  requestPermissions={false}
                  aria-label={t('Elegir cámara')}
                />
                <ScreenShareToggleButton setDeviceError={setDeviceError} />
              </div>
              <div className={styles.controlsGroup} role="group" aria-label={t('Interacción')}>
                <HandButton
                  buttonClassName={styles.iconButton}
                  activeClassName={styles.iconButtonActive}
                />
                <ReactionPicker buttonClassName={styles.iconButton} />
                <SoundboardPicker buttonClassName={styles.iconButton} />
                <CaptionsButton
                  buttonClassName={styles.iconButton}
                  activeClassName={styles.iconButtonActive}
                />
              </div>
              <div className={styles.controlsGroup} role="group" aria-label={t('Sala')}>
                <CallSettingsButton
                  buttonClassName={styles.iconButton}
                  isAdmin={isCurrentUserAdmin}
                  audioLocked={audioLocked}
                  videoLocked={videoLocked}
                  onSetAudioLock={onSetAudioLock}
                  onSetVideoLock={onSetVideoLock}
                  nameFocusEnabled={nameFocusEnabled}
                  onSetNameFocus={onSetNameFocus}
                  onShowShortcuts={() => setShortcutsOpen(true)}
                  pictureInPicture={pictureInPicture}
                />
                {/* Decisión 5 (design.md): único punto de montaje de toda la UI
                de mini salas -- reemplaza el disparador del dock
                (solo-admin) Y el sitio de montaje del banner (eliminado
                arriba). BreakoutView decide internamente qué renderizar
                (o nada) según resolveBreakoutViewState. */}
                <BreakoutView
                  roomCode={roomCode}
                  roomToken={roomToken}
                  isCurrentUserAdmin={isCurrentUserAdmin}
                  assignment={breakoutAssignment}
                  participants={participants}
                  currentParticipantId={currentParticipantId}
                  buttonClassName={styles.iconButton}
                  activeButtonClassName={styles.iconButtonActive}
                  showHostTrigger={false}
                />
              </div>
              <ConnectedHangUpButton />
            </div>
          </LayoutContextProvider>
        </TranscriptionProvider>
      </HandsProvider>
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
  isCurrentUserAdmin,
  audioLocked,
  videoLocked,
  onSetAudioLock,
  onSetVideoLock,
  participants = [],
  participantColors = NO_COLORS,
  roomSocket = null,
  currentParticipantId = '',
  nameFocusEnabled,
  onSetNameFocus,
}: MeetingRoomProps) {
  const router = useRouter();
  // Decisión 2 (design.md "Señal de motivo de remoción"): useRoomSocket se
  // llama UNA sola vez, acá -- en el ámbito de onDisconnected, donde
  // consumeRemovalNotice hace falta -- y breakoutAssignment se pasa hacia
  // abajo como prop (en vez de que MeetingContent llame al hook otra vez
  // sobre el mismo socket).
  const {
    breakoutAssignment,
    breakoutReturnSignal,
    consumeRemovalNotice,
    breakoutToasts,
    dismissBreakoutToast,
    restoreBreakoutAssignment,
  } = useRoomSocket(roomSocket);
  const [transition, setTransition] = useState<BreakoutTransitionState | null>(null);
  // Evita dos reconexiones a la principal cuando llegan juntos el aviso del socket y la desconexión.
  const returningRef = useRef(false);
  const returnToMainRef = useRef<() => void>(() => {});
  returnToMainRef.current = () => {
    if (returningRef.current) return;
    returningRef.current = true;
    setTransition({ kind: 'return' });
    startCall(roomCode, roomToken)
      .then((session) => call.switchRoom(session))
      .catch(() => {
        returningRef.current = false;
        setTransition(null);
        call.endedForBreakout();
      });
  };
  useEffect(() => {
    if (breakoutReturnSignal > 0) returnToMainRef.current();
  }, [breakoutReturnSignal]);
  const enteringLabel = breakoutAssignment?.label;
  const enteringId = breakoutAssignment?.alreadyInRoom ? undefined : breakoutAssignment?.breakoutId;
  useEffect(() => {
    if (enteringId && enteringLabel) setTransition({ kind: 'enter', label: enteringLabel });
  }, [enteringId, enteringLabel]);
  // Si un traslado falla a mitad de camino, la pantalla no puede quedar tapando la llamada.
  useEffect(() => {
    if (!transition) return;
    const timer = setTimeout(() => {
      returningRef.current = false;
      setTransition(null);
    }, TRANSITION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [transition]);
  const previousStatus = useRef(call.status);
  useEffect(() => {
    const was = previousStatus.current;
    previousStatus.current = call.status;
    if (call.status === 'error' || call.status === 'ended') {
      returningRef.current = false;
      setTransition(null);
      return;
    }
    if (call.status !== 'in-call' || was !== 'switching') return;
    returningRef.current = false;
    // Mínimo visible para que el cambio de sala se entienda aunque reconecte rápido.
    const timer = setTimeout(() => setTransition(null), 700);
    return () => clearTimeout(timer);
  }, [call.status]);
  const inBreakoutRoom = call.session?.roomName.includes('::') ?? false;
  // La asignación llega por un único evento de socket: si se perdió (recarga, reconexión), se recupera.
  const hasAssignment = breakoutAssignment !== null;
  useEffect(() => {
    if (!inBreakoutRoom || hasAssignment || returningRef.current) return;
    let cancelled = false;
    listBreakoutRooms(roomCode, roomToken)
      .then((rooms) => {
        if (cancelled) return;
        const mine = rooms.find((room) =>
          isAdminBreakoutView(room)
            ? room.occupants.some((occupant) => occupant.sourceIdentity === currentParticipantId)
            : room.selfAssigned,
        );
        if (!mine) return;
        restoreBreakoutAssignment({
          breakoutId: mine.id,
          label: mine.label,
          leavePolicy: mine.leavePolicy,
          closesAt: mine.autoCloseAt,
          alreadyInRoom: true,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    inBreakoutRoom,
    hasAssignment,
    roomCode,
    roomToken,
    currentParticipantId,
    restoreBreakoutAssignment,
  ]);
  const roomOptions = useMemo(
    () => ({
      ...options,
      audioCaptureDefaults: {
        ...audioProcessing(useCallSettingsStore.getState().noiseSuppression),
        deviceId: initialDevices.microphoneId || undefined,
      },
      videoCaptureDefaults: {
        ...options.videoCaptureDefaults,
        deviceId: initialDevices.cameraId || undefined,
      },
    }),
    [initialDevices.microphoneId, initialDevices.cameraId],
  );
  if (!call.session) return null;
  return (
    <>
      <LiveKitRoom
        // Traslado a/desde una mini sala (breakout-rooms, Flujo 1 de su
        // design.md): cambiar solo `token` sobre un <LiveKitRoom> ya montado
        // no reconecta de forma confiable. La `key` por roomName fuerza un
        // desmonte/montaje completo cada vez que switchRoom() cambia de sala.
        key={call.session.roomName}
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
          // El desmonte de la sala VIEJA que el propio cambio de `key` dispara
          // llega acá como un onDisconnected más: mientras el traslado está en
          // curso (status 'switching'), no es ni un "me fui" ni un fallo de
          // red, así que no hay que interpretarlo como ninguno de los dos.
          if (call.status === 'switching' || returningRef.current) return;
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
            // Cerrar una mini sala borra SU sala de LiveKit: no es el fin de la llamada.
            if (inBreakoutRoom) returnToMainRef.current();
            else call.endedByHost();
          } else if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
            // Decisión 2 (design.md "Señal de motivo de remoción"): antes de
            // este cambio, CUALQUIER PARTICIPANT_REMOVED caía en failed() --
            // la carrera que la propuesta identificó. El aviso consumido acá
            // ya llegó por el socket ANTES de este removeParticipant (mismo
            // orden que breakout:assigned, D12), con ventana de frescura de
            // 10s (useRoomSocket.consumeRemovalNotice).
            const notice = consumeRemovalNotice();
            if (notice?.reason === 'BREAKOUT_MOVE_IN') {
              // No-op: el issueBreakoutToken().then(switchRoom) en vuelo ya
              // resuelve el traslado -- no es ni un "me fui" ni un fallo.
              return;
            }
            if (notice?.reason === 'BREAKOUT_FORCED_RETURN') {
              returnToMainRef.current();
              return;
            }
            if (notice?.reason === 'BREAKOUT_RETURN_LOCKED') {
              call.removedByPolicy(notice.reason);
              return;
            }
            // Ningún aviso, o vencido: comportamiento de hoy intacto.
            call.failed(new Error('Disconnected'));
          } else call.failed(new Error('Disconnected'));
        }}
        data-lk-theme="default"
        className={styles.meetingRoom}
      >
        <ParticipantColorsContext.Provider value={participantColors}>
          <MeetingContent
            roomCode={roomCode}
            roomToken={roomToken}
            roomEmojis={roomEmojis}
            initialDevices={initialDevices}
            onTranscriptAvailable={onTranscriptAvailable}
            isCurrentUserAdmin={isCurrentUserAdmin}
            audioLocked={audioLocked}
            videoLocked={videoLocked}
            onSetAudioLock={onSetAudioLock}
            onSetVideoLock={onSetVideoLock}
            participants={participants}
            currentParticipantId={currentParticipantId}
            breakoutAssignment={breakoutAssignment}
            switchRoom={call.switchRoom}
            nameFocusEnabled={nameFocusEnabled}
            onSetNameFocus={onSetNameFocus}
          />
        </ParticipantColorsContext.Provider>
      </LiveKitRoom>
      {transition && <BreakoutTransition transition={transition} />}
      <BreakoutToasts toasts={breakoutToasts} onDismiss={dismissBreakoutToast} />
    </>
  );
}
