import { createContext, useContext } from 'react';
import type { Caption } from './transcript';
import type { SpeechRecognitionError } from './useSpeechRecognition';

export interface TranscriptionContextValue {
  supported: boolean;
  enabled: boolean;
  toggle: () => void;
  error: SpeechRecognitionError | null;
  saveFailed: boolean;
  // Una línea por persona: la frase que está diciendo o la última que terminó.
  captions: Caption[];
}

export const TranscriptionContext = createContext<TranscriptionContextValue | null>(null);

export function useTranscription(): TranscriptionContextValue {
  const context = useContext(TranscriptionContext);
  if (!context) throw new Error('useTranscription must be used inside TranscriptionProvider');
  return context;
}
