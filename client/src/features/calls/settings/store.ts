import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CaptionSize = 'small' | 'medium' | 'large';
export type CallDeviceKind = 'camera' | 'microphone';
export type CallPreference =
  'mutedNudge' | 'noiseSuppression' | 'joinLeaveSounds' | 'backgroundBlur';

interface CallSettingsState {
  captionSize: CaptionSize;
  setCaptionSize: (size: CaptionSize) => void;
  // Última elección de la persona, para preparar el lobby igual la próxima vez.
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  setDeviceEnabled: (kind: CallDeviceKind, enabled: boolean) => void;
  mutedNudge: boolean;
  noiseSuppression: boolean;
  joinLeaveSounds: boolean;
  backgroundBlur: boolean;
  setPreference: (key: CallPreference, value: boolean) => void;
}

export const useCallSettingsStore = create<CallSettingsState>()(
  persist(
    (set) => ({
      captionSize: 'medium',
      setCaptionSize: (captionSize) => set({ captionSize }),
      cameraEnabled: false,
      microphoneEnabled: false,
      setDeviceEnabled: (kind, enabled) =>
        set(kind === 'camera' ? { cameraEnabled: enabled } : { microphoneEnabled: enabled }),
      mutedNudge: true,
      noiseSuppression: true,
      joinLeaveSounds: false,
      backgroundBlur: false,
      setPreference: (key, value) => set({ [key]: value }),
    }),
    { name: 'date2gether:call-settings', version: 1 },
  ),
);
