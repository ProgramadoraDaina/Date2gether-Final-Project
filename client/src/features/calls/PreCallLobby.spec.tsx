import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { PreCallLobby } from './PreCallLobby';
import { useLanguageStore } from '../translation/store';

const getUserMedia = jest.fn<typeof navigator.mediaDevices.getUserMedia>();
const enumerateDevices = jest.fn<() => Promise<MediaDeviceInfo[]>>();
let deviceChange: (() => void) | undefined;
const join = jest.fn<(devices: unknown) => Promise<void>>();

function capture(kind: 'video' | 'audio', id: string) {
  const track = new EventTarget() as MediaStreamTrack;
  track.stop = jest.fn();
  track.getSettings = () => ({ deviceId: id });
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => (kind === 'video' ? [track] : []),
    getAudioTracks: () => (kind === 'audio' ? [track] : []),
  } as unknown as MediaStream;
  return { stream, track };
}
function Lobby() {
  const [name, setName] = useState('Ana');
  return (
    <PreCallLobby
      code="abc"
      name={name}
      onNameChange={setName}
      joining={false}
      error={null}
      onJoin={join}
    />
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  useLanguageStore.setState({ language: 'es' });
  enumerateDevices.mockResolvedValue([
    { kind: 'videoinput', deviceId: 'camera-1', label: 'Camera one' },
    { kind: 'videoinput', deviceId: 'camera-2', label: 'Camera two' },
    { kind: 'audioinput', deviceId: 'mic-1', label: 'Microphone one' },
  ] as MediaDeviceInfo[]);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices,
      addEventListener: (_: string, callback: () => void) => {
        deviceChange = callback;
      },
      removeEventListener: jest.fn(),
    },
  });
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  join.mockResolvedValue();
});

describe('PreCallLobby', () => {
  it('no pide permisos al abrir y permite entrar con ambos dispositivos apagados', async () => {
    render(<Lobby />);
    await screen.findByRole('option', { name: 'Camera one' });
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    expect(join).toHaveBeenCalledWith({
      cameraEnabled: false,
      microphoneEnabled: false,
      cameraId: '',
      microphoneId: '',
    });
  });

  it('previsualiza la cámara elegida, mide el micrófono por separado y entrega la elección al entrar', async () => {
    const camera = capture('video', 'camera-2');
    const mic = capture('audio', 'mic-1');
    getUserMedia.mockResolvedValueOnce(camera.stream).mockResolvedValueOnce(mic.stream);
    const view = render(<Lobby />);
    await screen.findByRole('option', { name: 'Camera two' });
    fireEvent.change(screen.getByLabelText('Elegir cámara'), { target: { value: 'camera-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activar cámara' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Vista previa de tu cámara')).toHaveProperty(
        'srcObject',
        camera.stream,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Activar micrófono' }));
    await screen.findByText('Hablá para comprobar el nivel del micrófono.');
    expect(getUserMedia.mock.calls).toEqual([
      [{ video: { deviceId: { exact: 'camera-2' } }, audio: false }],
      [{ video: false, audio: true }],
    ]);
    expect(screen.getByLabelText('Vista previa de tu cámara')).toHaveProperty('muted', true);
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    expect(join).toHaveBeenCalledWith({
      cameraEnabled: true,
      microphoneEnabled: true,
      cameraId: 'camera-2',
      microphoneId: 'mic-1',
    });
    view.unmount();
    expect(camera.track.stop).toHaveBeenCalled();
    expect(mic.track.stop).toHaveBeenCalled();
  });

  it('libera la cámara anterior al cambiar y detiene una respuesta tardía después de cancelar la prueba', async () => {
    const first = capture('video', 'camera-1');
    const late = capture('video', 'camera-2');
    let resolve!: (stream: MediaStream) => void;
    getUserMedia.mockResolvedValueOnce(first.stream).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<Lobby />);
    await screen.findByRole('option', { name: 'Camera two' });
    fireEvent.click(screen.getByRole('button', { name: 'Activar cámara' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Vista previa de tu cámara')).toHaveProperty(
        'srcObject',
        first.stream,
      ),
    );
    fireEvent.change(screen.getByLabelText('Elegir cámara'), { target: { value: 'camera-2' } });
    expect(first.track.stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Entrar a la reunión' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar cámara' }));
    await act(async () => {
      resolve(late.stream);
    });
    expect(late.track.stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Entrar a la reunión' })).toBeEnabled();
  });

  it('rechazar la cámara permite probar el micrófono y entrar sin cámara', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const mic = capture('audio', 'mic-1');
    getUserMedia.mockResolvedValueOnce(mic.stream);
    render(<Lobby />);
    fireEvent.click(screen.getByRole('button', { name: 'Activar cámara' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El permiso fue rechazado');
    fireEvent.click(screen.getByRole('button', { name: 'Activar micrófono' }));
    await screen.findByText('Hablá para comprobar el nivel del micrófono.');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    expect(join).toHaveBeenCalledWith(
      expect.objectContaining({ cameraEnabled: false, microphoneEnabled: true }),
    );
  });

  it('permite apagar un dispositivo después de desconectarlo y actualiza la lista al enchufar otro', async () => {
    const camera = capture('video', 'camera-1');
    getUserMedia.mockResolvedValueOnce(camera.stream);
    render(<Lobby />);
    fireEvent.click(screen.getByRole('button', { name: 'Activar cámara' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Vista previa de tu cámara')).toHaveProperty(
        'srcObject',
        camera.stream,
      ),
    );
    act(() => camera.track.dispatchEvent(new Event('ended')));
    expect(await screen.findByRole('alert')).toHaveTextContent('El dispositivo se desconectó');
    expect(camera.track.stop).toHaveBeenCalled();
    enumerateDevices.mockResolvedValue([
      { kind: 'videoinput', deviceId: 'new', label: 'New camera' },
    ] as MediaDeviceInfo[]);
    await act(async () => {
      deviceChange?.();
    });
    await screen.findByRole('option', { name: 'New camera' });
    expect(screen.getByRole('button', { name: 'Activar cámara' })).toBeEnabled();
  });

  it('al salir mientras hay un permiso pendiente libera el stream cuando el navegador responde', async () => {
    const late = capture('audio', 'mic-1');
    let resolve!: (stream: MediaStream) => void;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(<Lobby />);
    fireEvent.click(screen.getByRole('button', { name: 'Activar micrófono' }));
    view.unmount();
    await act(async () => {
      resolve(late.stream);
    });
    expect(late.track.stop).toHaveBeenCalled();
  });

  it('sin soporte de captura informa la limitación y conserva el ingreso sin dispositivos', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    render(<Lobby />);
    expect(await screen.findByRole('status')).toHaveTextContent('Usá HTTPS o localhost');
    expect(screen.getByRole('button', { name: 'Activar cámara' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    expect(join).toHaveBeenCalledWith(
      expect.objectContaining({ cameraEnabled: false, microphoneEnabled: false }),
    );
  });
  it.each([
    ['NotFoundError', 'No se encontró el dispositivo'],
    ['NotReadableError', 'El dispositivo está ocupado'],
  ])('explica %s y permite reintentar la prueba', async (name, message) => {
    getUserMedia.mockRejectedValueOnce(new DOMException('capture failed', name));
    const camera = capture('video', 'camera-1');
    getUserMedia.mockResolvedValueOnce(camera.stream);
    render(<Lobby />);
    fireEvent.click(screen.getByRole('button', { name: 'Activar cámara' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Entrar a la reunión' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Activar cámara' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Vista previa de tu cámara')).toHaveProperty(
        'srcObject',
        camera.stream,
      ),
    );
  });
  it('traduce las acciones y los mensajes del lobby al inglés', async () => {
    useLanguageStore.setState({ language: 'en' });
    render(<Lobby />);
    expect(screen.getByRole('heading', { name: 'Join the meeting' })).toBeVisible();
    expect(screen.getByLabelText('Choose camera')).toBeVisible();
    expect(screen.getByText('Camera off', { exact: true })).toBeVisible();
    await screen.findByRole('option', { name: 'Camera one' });
  });
});
