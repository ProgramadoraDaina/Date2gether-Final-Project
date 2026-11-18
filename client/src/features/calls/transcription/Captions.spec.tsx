import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLanguageStore } from '../../translation/store';
import { encodeCaption, PHRASE_PAUSE_MS } from './transcript';

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
  useRoomContext: jest.fn(() => ({ getSid: () => Promise.resolve('RM_call1') })),
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
  emit(resultIndex: number, results: [string, boolean][]) {
    this.onresult?.({
      resultIndex,
      results: results.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })),
    });
  }
  say(text: string, isFinal: boolean) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
  }
}

const decode = (payload: Uint8Array) => JSON.parse(new TextDecoder().decode(payload));

const mockFetch = jest.fn<typeof fetch>();
const onTranscriptAvailable = jest.fn();

async function renderCaptions() {
  const { TranscriptionProvider } = await import('./TranscriptionProvider');
  const { CaptionsButton, CaptionsOverlay } = await import('./Captions');
  render(
    <TranscriptionProvider
      roomCode="abc-defg-hij"
      roomToken="guest-room-token"
      onTranscriptAvailable={onTranscriptAvailable}
    >
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
    mockFetch.mockResolvedValue(new Response(null, { status: 201 }));
    global.fetch = mockFetch;
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

    jest.useFakeTimers();
    act(() => recognition.say('Hola a todos', true));
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Hola a todos')).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(PHRASE_PAUSE_MS));
    jest.useRealTimers();

    const [payload, options] = mockSend.mock.calls.at(-1) as unknown as [Uint8Array, object];
    expect(decode(payload)).toMatchObject({ text: 'Hola a todos', final: true });
    expect(options).toEqual({ reliable: true, topic: 'transcript' });
  });

  it('guarda cada frase final propia en el acta de la llamada y avisa el sid', async () => {
    await renderCaptions();
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    await waitFor(() => expect(onTranscriptAvailable).toHaveBeenCalledWith('RM_call1'));
    const recognition = FakeRecognition.instances[0];

    act(() => recognition.say('Hola a', false));
    expect(mockFetch).not.toHaveBeenCalled();
    jest.useFakeTimers();
    act(() => recognition.say('Hola a todos', true));
    expect(mockFetch).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(PHRASE_PAUSE_MS));
    jest.useRealTimers();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/transcripts\/abc-defg-hij$/);
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer guest-room-token' },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      callSid: 'RM_call1',
      content: 'Hola a todos',
    });
  });

  it('si el backend no guarda la frase, avisa sin cortar los subtítulos', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 500 }));
    await renderCaptions();
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    await waitFor(() => expect(onTranscriptAvailable).toHaveBeenCalled());
    jest.useFakeTimers();
    act(() => FakeRecognition.instances[0].say('Hola', true));
    act(() => jest.advanceTimersByTime(PHRASE_PAUSE_MS));
    jest.useRealTimers();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron guardar');
    expect(screen.getByText('Hola')).toBeInTheDocument();
  });

  it('junta las palabras que Chrome confirma de a una en una sola frase y la guarda una vez', async () => {
    await renderCaptions();
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    await waitFor(() => expect(onTranscriptAvailable).toHaveBeenCalled());
    const recognition = FakeRecognition.instances[0];
    jest.useFakeTimers();

    for (const word of ['me', 'encanta', 'esta', 'aplicacion'])
      act(() => recognition.say(word, true));
    expect(screen.getByText('me encanta esta aplicacion')).toBeInTheDocument();
    act(() => recognition.say('me encanta esta aplicacion', true));

    expect(screen.getAllByText('Ana')).toHaveLength(1);
    expect(screen.getByText('me encanta esta aplicacion')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(PHRASE_PAUSE_MS));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(mockFetch.mock.calls[0][1]?.body))).toEqual({
      callSid: 'RM_call1',
      content: 'me encanta esta aplicacion',
    });

    act(() => recognition.say('y otra cosa', true));
    act(() => jest.advanceTimersByTime(PHRASE_PAUSE_MS));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(mockFetch.mock.calls[1][1]?.body))).toMatchObject({
      content: 'y otra cosa',
    });
    jest.useRealTimers();
  });

  it('mientras hablás acumula todo lo dicho en vez de reemplazarlo por el último pedazo', async () => {
    await renderCaptions();
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    const recognition = FakeRecognition.instances[0];
    act(() =>
      recognition.emit(0, [
        ['me encanta', true],
        ['esta', false],
        ['aplicacion', false],
      ]),
    );
    expect(screen.getByText('me encanta esta aplicacion')).toBeInTheDocument();
    act(() =>
      recognition.emit(1, [
        ['me encanta', true],
        ['esta aplicacion y', false],
        ['la uso', false],
      ]),
    );
    expect(screen.getByText('me encanta esta aplicacion y la uso')).toBeInTheDocument();
  });

  it('si la frase se hace muy larga la guarda sin esperar la pausa', async () => {
    await renderCaptions();
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    await waitFor(() => expect(onTranscriptAvailable).toHaveBeenCalled());
    const long = 'palabra '.repeat(30).trim();
    act(() => FakeRecognition.instances[0].say(long, true));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('al apagar los subtítulos guarda la frase que estaba en curso', async () => {
    await renderCaptions();
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    await waitFor(() => expect(onTranscriptAvailable).toHaveBeenCalled());
    act(() => FakeRecognition.instances[0].say('Última frase', true));
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar subtítulos' }));
    expect(mockFetch).toHaveBeenCalledTimes(1);
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
    jest.useFakeTimers();
    await renderCaptions();
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    const recognition = FakeRecognition.instances[0];
    act(() => recognition.onend?.());
    act(() => jest.runOnlyPendingTimers());
    expect(recognition.start).toHaveBeenCalledTimes(2);
    act(() => recognition.onerror?.({ error: 'not-allowed' }));
    act(() => recognition.onend?.());
    act(() => jest.runOnlyPendingTimers());
    expect(recognition.start).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('no dio permiso');
    jest.useRealTimers();
  });

  it('si reiniciar falla o la red se corta un momento, sigue intentando sin cortar los subtítulos', async () => {
    jest.useFakeTimers();
    await renderCaptions();
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    const recognition = FakeRecognition.instances[0];

    recognition.start.mockImplementationOnce(() => {
      throw new Error('InvalidStateError');
    });
    act(() => recognition.onend?.());
    act(() => jest.runOnlyPendingTimers());
    act(() => jest.runOnlyPendingTimers());
    expect(recognition.start).toHaveBeenCalledTimes(3);

    act(() => recognition.onerror?.({ error: 'network' }));
    act(() => recognition.onend?.());
    act(() => jest.runOnlyPendingTimers());
    expect(recognition.start).toHaveBeenCalledTimes(4);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    act(() => recognition.say('Sigo acá', true));
    expect(screen.getByText('Sigo acá')).toBeInTheDocument();

    for (let i = 0; i < 4; i++) {
      act(() => recognition.onerror?.({ error: 'network' }));
      act(() => recognition.onend?.());
      act(() => jest.runOnlyPendingTimers());
    }
    expect(screen.getByRole('alert')).toHaveTextContent('Se cortó la conexión');
    jest.useRealTimers();
  });

  it('el tamaño de letra elegido en los ajustes de la llamada se aplica a los subtítulos', async () => {
    const { useCallSettingsStore } = await import('../settings/store');
    act(() => useCallSettingsStore.setState({ captionSize: 'large' }));
    await renderCaptions();
    fireEvent.click(screen.getByRole('button', { name: 'Activar subtítulos' }));
    act(() => FakeRecognition.instances[0].say('Hola', true));
    expect(screen.getByText('Hola').closest('[data-size]')).toHaveAttribute('data-size', 'large');
    act(() => useCallSettingsStore.setState({ captionSize: 'medium' }));
  });
});
