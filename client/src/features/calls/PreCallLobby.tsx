'use client';

import Link from 'next/link';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from '../translation/useTranslation';
import type { CallDevices } from './callDevices';
import { useAvailableDevices, useDevicePreview } from './useDevicePreview';
import styles from './PreCallLobby.module.css';

const subscribeToMediaSupport = () => () => {};
const mediaUnsupported = () => !navigator.mediaDevices?.getUserMedia;
const serverMediaUnsupported = () => false;

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
  const controls = [
    {
      kind: 'videoinput',
      preview: camera,
      label: 'Elegir cámara',
      fallback: 'Cámara',
      enable: 'Activar cámara',
      disable: 'Desactivar cámara',
    },
    {
      kind: 'audioinput',
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
            <p>{t(camera.pending ? 'Esperando permiso de cámara…' : 'Cámara apagada')}</p>
          )}
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
        <p className="code">{code}</p>
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
          {controls.map(({ kind, preview, label, fallback, enable, disable }) => {
            const devices = available.devices.filter(
              (device) => device.kind === kind && device.deviceId,
            );
            return (
              <div className={styles.device} key={kind}>
                <label htmlFor={kind}>{t(label)}</label>
                <div className={styles.deviceRow}>
                  <select
                    id={kind}
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
                  <button
                    type="button"
                    aria-pressed={preview.enabled}
                    disabled={unsupported}
                    onClick={() => preview.setEnabled(!preview.enabled)}
                  >
                    {t(preview.enabled ? disable : enable)}
                  </button>
                </div>
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
