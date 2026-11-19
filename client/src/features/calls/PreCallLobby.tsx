'use client';

import Link from 'next/link';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from '../translation/useTranslation';
import type { CallDevices } from './callDevices';
import { useCallSettingsStore } from './settings/store';
import { useAvailableDevices, useDevicePreview } from './useDevicePreview';
import { InitialsAvatar } from './InitialsAvatar';
import styles from './PreCallLobby.module.css';

const subscribeToMediaSupport = () => () => {};
const mediaUnsupported = () => !navigator.mediaDevices?.getUserMedia;
const serverMediaUnsupported = () => false;

// Mismas formas que MicIcon/CameraIcon en MeetingRoom.tsx: el dock de
// controles de la previa reutiliza el lenguaje visual del dock real de la
// llamada (ver .iconButton en MeetingRoom.module.css), así que conviene que
// el ícono ya sea un objeto conocido en vez de uno nuevo.
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

function CameraPreview({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);
  const { t } = useTranslation();
  return <video ref={ref} autoPlay muted playsInline aria-label={t('Vista previa de tu cámara')} />;
}

function MicrophoneLevel({ stream }: { stream: MediaStream | null }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLMeterElement>(null);
  useEffect(() => {
    const meter = ref.current;
    if (!stream || !window.AudioContext) return;
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    let frame = 0;
    try {
      context = new AudioContext();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      // Sin conexión al destino: se mide el micrófono sin reproducirlo.
      const samples = new Uint8Array(analyser.fftSize);
      const update = () => {
        analyser!.getByteTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length,
        );
        if (meter) meter.value = Math.min(100, Math.round(rms * 300));
        frame = requestAnimationFrame(update);
      };
      void context.resume().catch(() => undefined);
      update();
    } catch {
      // La prueba del micrófono sigue disponible aunque no haya medidor.
    }
    return () => {
      cancelAnimationFrame(frame);
      source?.disconnect();
      analyser?.disconnect();
      if (context) void context.close().catch(() => undefined);
      if (meter) meter.value = 0;
    };
  }, [stream]);
  return <meter ref={ref} min={0} max={100} value={0} aria-label={t('Nivel del micrófono')} />;
}

async function permissionGranted(name: 'camera' | 'microphone'): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: name as PermissionName });
    return status?.state === 'granted';
  } catch {
    // Firefox no reconoce 'camera' ni 'microphone' en la Permissions API.
    return false;
  }
}

// Repite la última elección solo si el navegador ya dio permiso: nunca pide permisos sin un click.
function useRestoreDevices(
  setCamera: (enabled: boolean) => void,
  setMicrophone: (enabled: boolean) => void,
) {
  const setters = useRef({ camera: setCamera, microphone: setMicrophone });
  useEffect(() => {
    setters.current = { camera: setCamera, microphone: setMicrophone };
  });
  useEffect(() => {
    let active = true;
    const saved = useCallSettingsStore.getState();
    const wanted = [
      saved.cameraEnabled && ('camera' as const),
      saved.microphoneEnabled && ('microphone' as const),
    ].filter((kind) => kind !== false);
    for (const kind of wanted) {
      void permissionGranted(kind).then((granted) => {
        if (active && granted) setters.current[kind](true);
      });
    }
    return () => {
      active = false;
    };
  }, []);
}

interface Props {
  code: string;
  name: string;
  onNameChange(name: string): void;
  joining: boolean;
  error: string | null;
  onJoin(devices: CallDevices): Promise<void>;
}

export function PreCallLobby({ code, name, onNameChange, joining, error, onJoin }: Props) {
  const { t } = useTranslation();
  const camera = useDevicePreview('video');
  const microphone = useDevicePreview('audio');
  const available = useAvailableDevices(camera.stream, microphone.stream);
  const unsupported = useSyncExternalStore(
    subscribeToMediaSupport,
    mediaUnsupported,
    serverMediaUnsupported,
  );
  const pending = camera.pending || microphone.pending;
  const setDeviceEnabled = useCallSettingsStore((state) => state.setDeviceEnabled);
  useRestoreDevices(camera.setEnabled, microphone.setEnabled);
  const controls = [
    {
      kind: 'videoinput',
      device: 'camera',
      preview: camera,
      label: 'Elegir cámara',
      fallback: 'Cámara',
      enable: 'Activar cámara',
      disable: 'Desactivar cámara',
    },
    {
      kind: 'audioinput',
      device: 'microphone',
      preview: microphone,
      label: 'Elegir micrófono',
      fallback: 'Micrófono',
      enable: 'Activar micrófono',
      disable: 'Desactivar micrófono',
    },
  ] as const;

  return (
    <section className={styles.lobby} aria-labelledby="lobby-title">
      <div className={styles.previewPanel}>
        <div className={styles.preview}>
          <CameraPreview stream={camera.stream} />
          {!camera.stream && (
            <div className={styles.cameraOff}>
              <InitialsAvatar name={name || '?'} size={72} />
              <p>{t(camera.pending ? 'Esperando permiso de cámara…' : 'Cámara apagada')}</p>
            </div>
          )}
        </div>
        {/* Dock fuera de .preview a propósito: .preview tiene overflow:hidden
            (recorta el video a las esquinas redondeadas) y lo cortaría. Se
            superpone al borde inferior del video por margin-top negativo,
            mismo truco que .controlsDock en MeetingRoom.module.css. */}
        <div className={styles.controlsDock}>
          {controls.map(({ kind, device, preview, enable, disable }) => {
            const label = t(preview.enabled ? disable : enable);
            return (
              <button
                key={kind}
                type="button"
                className={`${styles.iconButton} ${preview.enabled ? styles.iconButtonActive : ''}`}
                aria-pressed={preview.enabled}
                disabled={unsupported}
                onClick={() => {
                  preview.setEnabled(!preview.enabled);
                  setDeviceEnabled(device, !preview.enabled);
                }}
                title={label}
                aria-label={label}
              >
                {kind === 'videoinput' ? (
                  <CameraIcon off={!preview.enabled} />
                ) : (
                  <MicIcon muted={!preview.enabled} />
                )}
              </button>
            );
          })}
        </div>
        <p className={styles.hint}>
          {t('Esta prueba es solo para vos. Nadie te ve ni te escucha hasta que entrás.')}
        </p>
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (joining || pending || !name.trim()) return;
          void onJoin({
            cameraEnabled: camera.enabled && !!camera.stream,
            microphoneEnabled: microphone.enabled && !!microphone.stream,
            cameraId: camera.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? camera.deviceId,
            microphoneId:
              microphone.stream?.getAudioTracks()[0]?.getSettings().deviceId ?? microphone.deviceId,
          });
        }}
      >
        <h1 id="lobby-title">{t('Entrar a la reunión')}</h1>
        <p className={styles.code}>{code}</p>
        <p>{t('Elegí cómo querés aparecer. No necesitás una cuenta.')}</p>
        <fieldset disabled={joining}>
          <legend>{t('Prepará tu cámara y micrófono')}</legend>
          <label htmlFor="guest-name">{t('Tu nombre en la reunión')}</label>
          <input
            id="guest-name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            maxLength={60}
            required
            autoComplete="nickname"
          />
          {controls.map(({ kind, preview, label, fallback }) => {
            const devices = available.devices.filter(
              (device) => device.kind === kind && device.deviceId,
            );
            return (
              <div className={styles.device} key={kind}>
                <label htmlFor={kind}>{t(label)}</label>
                <select
                  id={kind}
                  className={styles.deviceSelect}
                  value={preview.deviceId}
                  onChange={(event) => preview.setDeviceId(event.target.value)}
                >
                  <option value="">{t('Predeterminado del sistema')}</option>
                  {preview.deviceId &&
                    !devices.some((device) => device.deviceId === preview.deviceId) && (
                      <option value={preview.deviceId}>{t('Dispositivo no disponible')}</option>
                    )}
                  {devices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || t(fallback) + ' ' + (index + 1)}
                    </option>
                  ))}
                </select>
                {preview.pending && (
                  <p role="status">
                    {t(
                      'Esperando permiso del navegador. Podés apagar el dispositivo para continuar.',
                    )}
                  </p>
                )}
                {preview.error && (
                  <p className={styles.error} role="alert">
                    {t(preview.error)}
                  </p>
                )}
              </div>
            );
          })}
          <MicrophoneLevel stream={microphone.stream} />
          <p className={styles.hint} aria-live="polite">
            {t(
              microphone.stream
                ? 'Hablá para comprobar el nivel del micrófono.'
                : 'Micrófono apagado',
            )}
          </p>
          {unsupported && (
            <p role="status">
              {t(
                'Este navegador no permite probar dispositivos. Usá HTTPS o localhost; podés entrar sin cámara ni micrófono.',
              )}
            </p>
          )}
          {available.error && (
            <p role="status">
              {t(
                'No se pudo obtener la lista de dispositivos. Podés probar el dispositivo predeterminado.',
              )}
            </p>
          )}
          <button type="submit" disabled={joining || pending || !name.trim()}>
            {joining ? t('Entrando…') : t('Entrar a la reunión')}
          </button>
        </fieldset>
        {error && (
          <p className={styles.error} role="alert" data-testid="error-message">
            {error}
          </p>
        )}
        <Link href="/">{t('Volver al inicio')}</Link>
      </form>
    </section>
  );
}
