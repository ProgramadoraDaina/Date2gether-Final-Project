import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CaptionSize = 'small' | 'medium' | 'large';

interface CallSettingsState {
  captionSize: CaptionSize;
  setCaptionSize: (size: CaptionSize) => void;
}

export const useCallSettingsStore = create<CallSettingsState>()(
  persist(
    (set) => ({
      captionSize: 'medium',
      setCaptionSize: (captionSize) => set({ captionSize }),
    }),
    { name: 'date2gether:call-settings', version: 1 },
  ),
);
