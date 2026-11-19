import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CaptionSize = 'small' | 'medium' | 'large';
export type CallDeviceKind = 'camera' | 'microphone';

interface CallSettingsState {
  captionSize: CaptionSize;
  setCaptionSize: (size: CaptionSize) => void;
  // Última elección de la persona, para preparar el lobby igual la próxima vez.
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  setDeviceEnabled: (kind: CallDeviceKind, enabled: boolean) => void;
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
    }),
    { name: 'date2gether:call-settings', version: 1 },
  ),
);
