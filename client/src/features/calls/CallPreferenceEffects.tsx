'use client';

import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';
import { useEffect, useRef } from 'react';
import { useCallSettingsStore } from './settings/store';
import { JOIN_TONE, LEAVE_TONE, playTones } from './tones';

export function audioProcessing(noiseSuppression: boolean) {
  return { noiseSuppression, echoCancellation: true, autoGainControl: true };
}

// Cambiar la supresión con el mic prendido reinicia la captura con la nueva opción.
function NoiseSuppressionSync() {
  const room = useRoomContext();
  const noiseSuppression = useCallSettingsStore((state) => state.noiseSuppression);
  const applied = useRef(noiseSuppression);
  useEffect(() => {
    if (applied.current === noiseSuppression) return;
    applied.current = noiseSuppression;
    const processing = audioProcessing(noiseSuppression);
    room.options.audioCaptureDefaults = { ...room.options.audioCaptureDefaults, ...processing };
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    if (track && !track.isMuted) {
      void track
        .restartTrack({ ...processing, deviceId: room.getActiveDevice('audioinput') })
        .catch(() => undefined);
    }
  }, [room, noiseSuppression]);
  return null;
}

function PresenceSounds() {
  const room = useRoomContext();
  useEffect(() => {
    const play = (notes: number[]) => () => {
      if (useCallSettingsStore.getState().joinLeaveSounds) void playTones(notes, 0.08);
    };
    const joined = play(JOIN_TONE);
    const left = play(LEAVE_TONE);
    room.on(RoomEvent.ParticipantConnected, joined);
    room.on(RoomEvent.ParticipantDisconnected, left);
    return () => {
      room.off(RoomEvent.ParticipantConnected, joined);
      room.off(RoomEvent.ParticipantDisconnected, left);
    };
  }, [room]);
  return null;
}

export function CallPreferenceEffects() {
  return (
    <>
      <NoiseSuppressionSync />
      <PresenceSounds />
    </>
  );
}
