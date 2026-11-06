'use client';

import { useDataChannel, useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { saveTranscriptLine } from '@/lib/transcripts';
import { useTranslation } from '../../translation/useTranslation';
import {
  CAPTION_LIFETIME_MS,
  decodeCaption,
  encodeCaption,
  MAX_CAPTION_LENGTH,
  recognitionLang,
  TRANSCRIPT_TOPIC,
  type Caption,
  type CaptionMessage,
} from './transcript';
import {
  useSpeechRecognition,
  useSpeechRecognitionSupported,
  type SpeechResult,
} from './useSpeechRecognition';
import { TranscriptionContext } from './useTranscription';

// Los resultados parciales llegan muchas veces por segundo: se mandan como mucho cada tanto.
const INTERIM_SEND_INTERVAL_MS = 300;

interface TranscriptionProviderProps {
  children: ReactNode;
  roomCode: string;
  roomToken: string;
  // Avisa el sid de la llamada apenas se activan los subtítulos, para poder pedir el acta después.
  onTranscriptAvailable?: (callSid: string) => void;
}

export function TranscriptionProvider({
  children,
  roomCode,
  roomToken,
  onTranscriptAvailable,
}: TranscriptionProviderProps) {
  const { language } = useTranslation();
  const room = useRoomContext();
  const [callSid, setCallSid] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const supported = useSpeechRecognitionSupported();
  const [enabled, setEnabled] = useState(false);
  const [captions, setCaptions] = useState<Record<string, Caption>>({});
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const phraseId = useRef<string | null>(null);
  const lastInterimSentAt = useRef(0);

  useEffect(() => {
    let active = true;
    room
      .getSid()
      .then((sid) => active && setCallSid(sid))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [room]);

  useEffect(() => {
    if (enabled && callSid) onTranscriptAvailable?.(callSid);
  }, [enabled, callSid, onTranscriptAvailable]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const showCaption = useCallback((caption: Caption) => {
    setCaptions((prev) => ({ ...prev, [caption.identity]: caption }));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      // Solo se borra si nadie la reemplazó: la persona pudo haber seguido hablando.
      setCaptions((prev) => {
        if (prev[caption.identity]?.at !== caption.at) return prev;
        const next = { ...prev };
        delete next[caption.identity];
        return next;
      });
    }, CAPTION_LIFETIME_MS);
    timers.current.add(timer);
  }, []);

  const { send } = useDataChannel(TRANSCRIPT_TOPIC, (msg) => {
    const message = decodeCaption(msg.payload);
    if (!message || !msg.from) return;
    showCaption({
      ...message,
      identity: msg.from.identity,
      name: msg.from.name || msg.from.identity,
      at: Date.now(),
    });
  });

  const handleResult = useCallback(
    ({ text, final }: SpeechResult) => {
      phraseId.current ??= crypto.randomUUID();
      const message: CaptionMessage = {
        id: phraseId.current,
        text: text.slice(0, MAX_CAPTION_LENGTH),
        final,
      };
      if (final) {
        phraseId.current = null;
        // Cada persona guarda solo sus propias frases: así el acta no se duplica.
        if (callSid) {
          saveTranscriptLine(roomCode, roomToken, callSid, message.text).then(
            () => setSaveFailed(false),
            () => setSaveFailed(true),
          );
        }
      }
      // LiveKit no le devuelve al emisor sus propios mensajes: se muestra localmente.
      showCaption({
        ...message,
        identity: localParticipant.identity,
        name: localParticipant.name || localParticipant.identity,
        at: Date.now(),
      });
      const now = Date.now();
      if (!final && now - lastInterimSentAt.current < INTERIM_SEND_INTERVAL_MS) return;
      lastInterimSentAt.current = now;
      void send(encodeCaption(message), { reliable: final, topic: TRANSCRIPT_TOPIC });
    },
    [callSid, localParticipant, roomCode, roomToken, send, showCaption],
  );

  const { error } = useSpeechRecognition({
    enabled: supported && enabled && isMicrophoneEnabled,
    lang: recognitionLang(language),
    onResult: handleResult,
  });

  const toggle = useCallback(() => setEnabled((value) => !value), []);

  const value = useMemo(
    () => ({
      supported,
      enabled,
      toggle,
      error,
      saveFailed,
      captions: enabled ? Object.values(captions).sort((a, b) => a.at - b.at) : [],
    }),
    [supported, enabled, toggle, error, saveFailed, captions],
  );
  return <TranscriptionContext.Provider value={value}>{children}</TranscriptionContext.Provider>;
}
