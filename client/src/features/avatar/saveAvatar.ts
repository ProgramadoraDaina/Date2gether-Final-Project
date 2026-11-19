import { updateAvatar } from '@/lib/api';
import { isLoggedIn } from '@/lib/auth';
import type { Avatar } from './catalog';
import { useAvatarStore } from './store';

// Invitados: queda solo en este navegador. Cuentas: además se guarda en el servidor.
export async function saveMyAvatar(avatar: Avatar): Promise<void> {
  if (isLoggedIn()) await updateAvatar(avatar);
  useAvatarStore.getState().setAvatar(avatar);
}
