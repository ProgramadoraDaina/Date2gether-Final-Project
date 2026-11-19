'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function deviceErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'El permiso fue rechazado. Revisá los permisos del navegador o entrá con el dispositivo apagado.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No se encontró el dispositivo. Elegí otro o entrá con el dispositivo apagado.';
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'El dispositivo está ocupado o no se pudo iniciar. Cerrá otras aplicaciones e intentá otra vez.';
  return 'No se pudo activar el dispositivo. Podés reintentar o entrar con el dispositivo apagado.';
}

interface PreviewState {
  enabled: boolean;
  deviceId: string;
  stream: MediaStream | null;
  pending: boolean;
  error: string | null;
}

// Los permisos se solicitan solo desde una acción explícita. Cada dispositivo
// se abre por separado y las respuestas tardías liberan sus tracks.
export function useDevicePreview(kind: 'video' | 'audio') {
  const [state, setState] = useState<PreviewState>({
    enabled: false,
    deviceId: '',
    stream: null,
    pending: false,
    error: null,
  });
  const request = useRef(0);
  const cleanup = useRef<(() => void) | null>(null);
  const release = useCallback(() => {
    request.current++;
    cleanup.current?.();
    cleanup.current = null;
  }, []);
  useEffect(() => release, [release]);

  const start = useCallback(
    async (deviceId: string) => {
      release();
      const current = request.current;
      setState({ deviceId, enabled: true, stream: null, pending: true, error: null });
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setState({
            deviceId,
            enabled: false,
            stream: null,
            pending: false,
            error:
              'Este navegador no permite probar dispositivos. Usá HTTPS o localhost; podés entrar sin cámara ni micrófono.',
          });
          return;
        }
        const constraints = deviceId ? { deviceId: { exact: deviceId } } : true;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: kind === 'video' ? constraints : false,
          audio: kind === 'audio' ? constraints : false,
        });
        if (current !== request.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const ended = () => {
          release();
          setState({
            deviceId,
            enabled: false,
            stream: null,
            pending: false,
            error: 'El dispositivo se desconectó. Elegí otro y volvé a activarlo.',
          });
        };
        stream.getTracks().forEach((track) => track.addEventListener('ended', ended));
        cleanup.current = () =>
          stream.getTracks().forEach((track) => {
            track.removeEventListener('ended', ended);
            track.stop();
          });
        setState({ deviceId, enabled: true, stream, pending: false, error: null });
      } catch (cause) {
        if (current !== request.current) return;
        setState({
          deviceId,
          enabled: false,
          stream: null,
          pending: false,
          error: deviceErrorMessage(cause),
        });
      }
    },
    [kind, release],
  );

  function setEnabled(enabled: boolean) {
    if (enabled) void start(state.deviceId);
    else {
      release();
      setState((previous) => ({
        ...previous,
        enabled: false,
        stream: null,
        pending: false,
        error: null,
      }));
    }
  }
  function setDeviceId(deviceId: string) {
    if (state.enabled) void start(deviceId);
    else setState((previous) => ({ ...previous, deviceId, error: null }));
  }

  return { ...state, setEnabled, setDeviceId };
}

export function useAvailableDevices(camera: MediaStream | null, microphone: MediaStream | null) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let active = true;
    let request = 0;
    async function refresh() {
      const current = ++request;
      try {
        const list = await media.enumerateDevices();
        if (active && current === request) {
          setDevices(
            list.filter((device) => device.kind === 'videoinput' || device.kind === 'audioinput'),
          );
          setError(false);
        }
      } catch {
        if (active && current === request) setError(true);
      }
    }
    void refresh();
    media.addEventListener?.('devicechange', refresh);
    return () => {
      active = false;
      media.removeEventListener?.('devicechange', refresh);
    };
  }, [camera, microphone]);
  return { devices, error };
}
