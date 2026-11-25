'use client';

import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { useEffect, useState } from 'react';
import { useTranslation } from '../translation/useTranslation';
import { useCallSettingsStore } from './settings/store';
import { createSpeechGate, rmsOf } from './mutedSpeech';
import styles from './MeetingRoom.module.css';

const SAMPLE_MS = 100;
const VISIBLE_MS = 5000;
const COOLDOWN_MS = 20_000;

async function permissionGranted(name: string): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: name as PermissionName });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}

// Escucha el mic solo en este navegador mientras está apagado; nunca publica ese audio.
function useSpeakingWhileMuted(active: boolean, deviceId: string | undefined) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!active || typeof AudioContext === 'undefined') return;
    let stopped = false;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let mutedUntil = 0;
    void (async () => {
      if (!(await permissionGranted('microphone')) || stopped) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
      } catch {
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const gate = createSpeechGate();
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        const now = Date.now();
        if (gate(rmsOf(samples)) && now > mutedUntil) {
          mutedUntil = now + COOLDOWN_MS;
          setSpeaking(true);
        }
      }, SAMPLE_MS);
    })();
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (context) void context.close().catch(() => undefined);
      setSpeaking(false);
    };
  }, [active, deviceId]);
  useEffect(() => {
    if (!speaking) return;
    const timer = setTimeout(() => setSpeaking(false), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [speaking]);
  return [speaking, () => setSpeaking(false)] as const;
}

export function MutedNudge({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  const room = useRoomContext();
  const { isMicrophoneEnabled } = useLocalParticipant();
  const enabled = useCallSettingsStore((state) => state.mutedNudge);
  const remember = useCallSettingsStore((state) => state.setDeviceEnabled);
  const deviceId = room.getActiveDevice?.('audioinput');
  const [speaking, dismiss] = useSpeakingWhileMuted(
    enabled && !locked && !isMicrophoneEnabled,
    deviceId,
  );
  if (!speaking) return null;
  return (
    <div className={styles.mutedNudge} role="status">
      <span>{t('Estás silenciado')}</span>
      <button
        type="button"
        className={styles.mutedNudgeAction}
        onClick={() => {
          dismiss();
          remember('microphone', true);
          void room.localParticipant.setMicrophoneEnabled(true).catch(() => undefined);
        }}
      >
        {t('Activar micrófono')}
      </button>
      <button
        type="button"
        className={styles.mutedNudgeClose}
        onClick={dismiss}
        aria-label={t('Cerrar')}
        title={t('Cerrar')}
      >
        ×
      </button>
    </div>
  );
}
