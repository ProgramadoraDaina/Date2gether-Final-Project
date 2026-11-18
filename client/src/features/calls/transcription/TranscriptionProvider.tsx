'use client';

import { useDataChannel, useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { saveTranscriptLine } from '@/lib/transcripts';
import { useTranslation } from '../../translation/useTranslation';
import {
  CAPTION_LIFETIME_MS,
  decodeCaption,
  encodeCaption,
  MAX_CAPTION_LENGTH,
  PHRASE_PAUSE_MS,
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
const MAX_PHRASE_LENGTH = 200;

// Chrome a veces confirma palabra por palabra y después la oración entera, que ya las incluye.
function joinPhrase(base: string, next: string): string {
  if (!base) return next;
  if (next.toLowerCase().startsWith(base.toLowerCase())) return next;
  return `${base} ${next}`;
}

interface TranscriptionProviderProps {
  children: ReactNode;
  roomCode: string;
  roomToken: string;
  // Fires with the call sid as soon as it is known, so the transcript can be opened later.
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
  const phrase = useRef<{ id: string; text: string } | null>(null);
  const pauseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastInterimSentAt = useRef(0);

  useEffect(() => {
    let active = true;
    // getSid() devuelve '' si la sala todavía no conectó: se vuelve a pedir al conectar.
    const loadSid = () => {
      room
        .getSid()
        .then((sid) => active && sid && setCallSid(sid))
        .catch(() => undefined);
    };
    loadSid();
    room.on(RoomEvent.Connected, loadSid);
    return () => {
      active = false;
      room.off(RoomEvent.Connected, loadSid);
    };
  }, [room]);

  useEffect(() => {
    if (callSid) onTranscriptAvailable?.(callSid);
  }, [callSid, onTranscriptAvailable]);

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

  const showOwnCaption = useCallback(
    (message: CaptionMessage) => {
      // LiveKit no le devuelve al emisor sus propios mensajes: se muestra localmente.
      showCaption({
        ...message,
        identity: localParticipant.identity,
        name: localParticipant.name || localParticipant.identity,
        at: Date.now(),
      });
    },
    [localParticipant, showCaption],
  );

  const commitPhrase = useCallback(() => {
    clearTimeout(pauseTimer.current);
    const pending = phrase.current;
    phrase.current = null;
    if (!pending?.text) return;
    const message: CaptionMessage = { id: pending.id, text: pending.text, final: true };
    showOwnCaption(message);
    void send(encodeCaption(message), { reliable: true, topic: TRANSCRIPT_TOPIC });
    // Cada persona guarda solo sus propias frases: así el acta no se duplica.
    if (callSid) {
      saveTranscriptLine(roomCode, roomToken, callSid, message.text).then(
        () => setSaveFailed(false),
        () => setSaveFailed(true),
      );
    }
  }, [callSid, roomCode, roomToken, send, showOwnCaption]);

  const commitRef = useRef(commitPhrase);
  useEffect(() => {
    commitRef.current = commitPhrase;
  }, [commitPhrase]);

  const handleResult = useCallback(
    ({ text, final }: SpeechResult) => {
      const current = (phrase.current ??= { id: crypto.randomUUID(), text: '' });
      const combined = joinPhrase(current.text, text).slice(0, MAX_CAPTION_LENGTH);
      if (final) current.text = combined;
      showOwnCaption({ id: current.id, text: combined, final: false });

      clearTimeout(pauseTimer.current);
      if (final && current.text.length >= MAX_PHRASE_LENGTH) {
        commitRef.current();
        return;
      }
      pauseTimer.current = setTimeout(() => commitRef.current(), PHRASE_PAUSE_MS);

      const now = Date.now();
      if (now - lastInterimSentAt.current < INTERIM_SEND_INTERVAL_MS) return;
      lastInterimSentAt.current = now;
      void send(encodeCaption({ id: current.id, text: combined, final: false }), {
        reliable: false,
        topic: TRANSCRIPT_TOPIC,
      });
    },
    [send, showOwnCaption],
  );

  // Captions only control what is shown: the transcript is always recorded.
  const listening = supported && isMicrophoneEnabled;
  useEffect(() => {
    if (!listening) commitRef.current();
  }, [listening]);
  useEffect(() => () => commitRef.current(), []);

  const { error } = useSpeechRecognition({
    enabled: listening,
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
