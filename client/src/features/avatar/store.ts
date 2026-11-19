import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { EMPTY_AVATAR, type Avatar } from './catalog';

interface AvatarState {
  avatar: Avatar;
  setAvatar: (avatar: Avatar) => void;
}

// Copia local: los invitados solo tienen esta; las cuentas la pisan con la del servidor.
export const useAvatarStore = create<AvatarState>()(
  persist(
    (set) => ({
      avatar: EMPTY_AVATAR,
      setAvatar: (avatar) => set({ avatar }),
    }),
    { name: 'date2gether:avatar', version: 1 },
  ),
);
