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

interface FinalPhrase {
  identity: string;
  name: string;
  text: string;
}

interface TranscriptionProviderProps {
  children: ReactNode;
  roomCode: string;
  roomToken: string;
  // Fires with the call sid as soon as it is known, so the transcript can be opened later.
  onTranscriptAvailable?: (callSid: string) => void;
  // A diferencia de `captions` (gateado por el toggle de mostrar subtítulos:
  // "Captions only control what is shown: the transcript is always
  // recorded"), esto dispara con CUALQUIER frase final, propia o ajena, se
  // estén mostrando subtítulos o no — lo necesita el enfoque automático al
  // nombrar (ver MeetingRoom.tsx), que no depende de esa preferencia visual.
  onFinalPhrase?: (phrase: FinalPhrase) => void;
}

export function TranscriptionProvider({
  children,
  roomCode,
  roomToken,
  onTranscriptAvailable,
  onFinalPhrase,
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
    const identity = msg.from.identity;
    const name = msg.from.name || identity;
    showCaption({ ...message, identity, name, at: Date.now() });
    if (message.final) onFinalPhrase?.({ identity, name, text: message.text });
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

  // Lines wait here until the call sid is known, and stay if a save fails so none is lost.
  const unsaved = useRef<string[]>([]);
  const flushing = useRef(false);
  const flushUnsaved = useCallback(async () => {
    if (!callSid || flushing.current) return;
    flushing.current = true;
    try {
      while (unsaved.current.length > 0) {
        try {
          await saveTranscriptLine(roomCode, roomToken, callSid, unsaved.current[0]);
        } catch {
          setSaveFailed(true);
          return;
        }
        unsaved.current.shift();
        setSaveFailed(false);
      }
    } finally {
      flushing.current = false;
    }
  }, [callSid, roomCode, roomToken]);

  useEffect(() => {
    void flushUnsaved();
  }, [flushUnsaved]);

  const commitPhrase = useCallback(() => {
    clearTimeout(pauseTimer.current);
    const pending = phrase.current;
    phrase.current = null;
    if (!pending?.text) return;
    const message: CaptionMessage = { id: pending.id, text: pending.text, final: true };
    showOwnCaption(message);
    void send(encodeCaption(message), { reliable: true, topic: TRANSCRIPT_TOPIC });
    onFinalPhrase?.({
      identity: localParticipant.identity,
      name: localParticipant.name || localParticipant.identity,
      text: message.text,
    });
    // Cada persona guarda solo sus propias frases: así el acta no se duplica.
    unsaved.current.push(message.text);
    void flushUnsaved();
  }, [flushUnsaved, send, showOwnCaption, onFinalPhrase, localParticipant]);

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
