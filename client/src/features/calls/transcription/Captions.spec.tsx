import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useLanguageStore } from '../../translation/store';
import { encodeCaption } from './transcript';

type DataHandler = (msg: {
  payload: Uint8Array;
  from?: { identity: string; name?: string };
}) => void;

const mockSend = jest.fn(() => Promise.resolve());
let dataHandler: DataHandler | undefined;
let micEnabled = true;

jest.mock('@livekit/components-react', () => ({
  useDataChannel: jest.fn((_topic: string, onMessage: DataHandler) => {
    dataHandler = onMessage;
    return { send: mockSend };
  }),
  useLocalParticipant: jest.fn(() => ({
    localParticipant: { identity: 'ana-id', name: 'Ana' },
    isMicrophoneEnabled: micEnabled,
  })),
}));

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = jest.fn();
  stop = jest.fn();
  abort = jest.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
  say(text: string, isFinal: boolean) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
  }
}

const decode = (payload: Uint8Array) => JSON.parse(new TextDecoder().decode(payload));

async function renderCaptions() {
  const { TranscriptionProvider } = await import('./TranscriptionProvider');
  const { CaptionsButton, CaptionsOverlay } = await import('./Captions');
  render(
    <TranscriptionProvider>
      <CaptionsOverlay />
      <CaptionsButton buttonClassName="btn" activeClassName="active" />
    </TranscriptionProvider>,
  );
}

describe('Subtítulos en vivo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    FakeRecognition.instances = [];
    micEnabled = true;
    useLanguageStore.setState({ language: 'es' });
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition =
      FakeRecognition;
  });

  afterEach(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  it('sin soporte del navegador el botón queda deshabilitado y explica por qué', async () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    await renderCaptions();
    const button = screen.getByRole('button', { name: /Probá con Chrome o Edge/ });
    expect(button).toBeDisabled();
  });

  it('al activarlos transcribe el micrófono propio en el idioma de la app y manda la frase a la sala', async () => {
    await renderCaptions();
    expect(FakeRecognition.instances).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    const recognition = FakeRecognition.instances[0];
    expect(recognition.lang).toBe('es-AR');
    expect(recognition.start).toHaveBeenCalledTimes(1);

    act(() => recognition.say('Hola a todos', true));

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Hola a todos')).toBeInTheDocument();
    const [payload, options] = mockSend.mock.calls[0] as unknown as [Uint8Array, object];
    expect(decode(payload)).toMatchObject({ text: 'Hola a todos', final: true });
    expect(options).toEqual({ reliable: true, topic: 'transcript' });
  });

  it('con el micrófono apagado no transcribe aunque los subtítulos estén activos', async () => {
    micEnabled = false;
    await renderCaptions();
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it('muestra lo que dicen los demás con su nombre y descarta mensajes inválidos', async () => {
    await renderCaptions();
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    act(() =>
      dataHandler?.({
        payload: encodeCaption({ id: 'f1', text: '¿Me escuchan?', final: false }),
        from: { identity: 'juan-id', name: 'Juan' },
      }),
    );
    act(() =>
      dataHandler?.({
        payload: new TextEncoder().encode('basura'),
        from: { identity: 'otro', name: 'Otro' },
      }),
    );
    expect(screen.getByText('Juan')).toBeInTheDocument();
    expect(screen.getByText('¿Me escuchan?')).toBeInTheDocument();
    expect(screen.queryByText('Otro')).not.toBeInTheDocument();
  });

  it('al desactivarlos corta el reconocimiento y oculta los subtítulos', async () => {
    await renderCaptions();
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    const recognition = FakeRecognition.instances[0];
    act(() => recognition.say('Chau', true));
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar subtítulos' }));
    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Chau')).not.toBeInTheDocument();
  });

  it('si Chrome corta por silencio, vuelve a escuchar; si se niega el permiso, avisa', async () => {
    await renderCaptions();
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    const recognition = FakeRecognition.instances[0];
    act(() => recognition.onend?.());
    expect(recognition.start).toHaveBeenCalledTimes(2);
    act(() => recognition.onerror?.({ error: 'not-allowed' }));
    act(() => recognition.onend?.());
    expect(recognition.start).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('no dio permiso');
  });
});
