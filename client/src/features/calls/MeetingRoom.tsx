'use client';

import {
  ConnectionStateToast,
  DisconnectButton,
  GridLayout,
  LiveKitRoom,
  MediaDeviceMenu,
  ParticipantTile,
  RoomAudioRenderer,
  StartAudio,
  TrackToggle,
  useTracks,
} from '@livekit/components-react';
import { DisconnectReason, Track, VideoPresets, type RoomOptions } from 'livekit-client';
import { useState } from 'react';
import { useTranslation } from '../translation/useTranslation';
import type { CallSessionState } from './useCallSession';

const options: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
  publishDefaults: {
    videoCodec: 'vp8',
    videoSimulcastLayers: [VideoPresets.h90, VideoPresets.h180],
  },
};

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
      <GridLayout tracks={tracks} className="meeting-grid">
        <ParticipantTile />
      </GridLayout>
      {deviceError && (
        <p className="error" role="alert">
          {t(
            'No se pudo activar el dispositivo. Revisá los permisos del navegador; podés continuar en la llamada.',
          )}
        </p>
      )}
      <div className="meeting-controls">
        <TrackToggle
          source={Track.Source.Microphone}
          onDeviceError={() => setDeviceError(true)}
          onChange={() => setDeviceError(false)}
        >
          {t('Micrófono')}
        </TrackToggle>
        <MediaDeviceMenu
          kind="audioinput"
          requestPermissions={false}
          aria-label={t('Elegir micrófono')}
        />
        <TrackToggle
          source={Track.Source.Camera}
          onDeviceError={() => setDeviceError(true)}
          onChange={() => setDeviceError(false)}
        >
          {t('Cámara')}
        </TrackToggle>
        <MediaDeviceMenu
          kind="videoinput"
          requestPermissions={false}
          aria-label={t('Elegir cámara')}
        />
        <DisconnectButton>{t('Colgar')}</DisconnectButton>
      </div>
    </>
  );
}

export default function MeetingRoom({ call }: { call: CallSessionState }) {
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
        if (reason === undefined || reason === DisconnectReason.CLIENT_INITIATED) call.leaveCall();
        else call.failed(new Error('Disconnected'));
      }}
      data-lk-theme="default"
      className="meeting-room"
    >
      <MeetingContent />
    </LiveKitRoom>
  );
}
