import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// TypeScript 5.7 no trae los tipos de la Web Speech API: se declara lo mínimo que se usa.
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionConstructor = new () => Recognition;

const RESTART_DELAY_MS = 250;
const MAX_NETWORK_RETRIES = 3;

export type SpeechRecognitionError ='not-allowed' | 'network' | 'unknown';

export interface SpeechResult {
  text: string;
  final: boolean;
}

function getRecognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => undefined;

// El server no tiene `window`: devuelve false y el cliente lo corrige después de hidratar.
export function useSpeechRecognitionSupported(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => getRecognitionConstructor() !== null,
    () => false,
  );
}

interface Options {
  enabled: boolean;
  lang: string;
  onResult: (result: SpeechResult) => void;
}

export function useSpeechRecognition({ enabled, lang, onResult }: Options) {
  const [error, setError] = useState<SpeechRecognitionError | null>(null);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    const Ctor = getRecognitionConstructor();
    if (!enabled || !Ctor) return;
    let stopped = false;
    let networkFailures = 0;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      networkFailures = 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (text) onResultRef.current({ text, final: result.isFinal });
      }
    };
    recognition.onerror = ({ error: code }) => {
      // 'no-speech' y 'aborted' son normales: silencio largo o un stop() propio.
      if (code === 'no-speech' || code === 'aborted') return;
      if (code === 'network' && ++networkFailures <= MAX_NETWORK_RETRIES) return;
      stopped = true;
      setError(code === 'not-allowed' || code === 'network' ? code : 'unknown');
    };
    const start = () => {
      if (stopped) return;
      try {
        recognition.start();
      } catch {
        // Chrome tira InvalidStateError si todavía no terminó de cerrar la sesión anterior.
        restartTimer = setTimeout(start, RESTART_DELAY_MS);
      }
    };
    // Chrome corta el reconocimiento tras un rato aunque sea continuo: se reinicia.
    recognition.onend = () => {
      restartTimer = setTimeout(start, RESTART_DELAY_MS);
    };
    start();
    return () => {
      stopped = true;
      clearTimeout(restartTimer);
      recognition.onend = null;
      recognition.abort();
      setError(null);
    };
  }, [enabled, lang]);

  return { error };
}
