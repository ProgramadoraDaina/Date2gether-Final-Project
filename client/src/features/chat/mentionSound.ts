import { isMentionSoundEnabled } from './mentionPreferences';

// Efecto "no copyright" de aviso de mensaje, igual al resto de sonidos de
// la app (ver roomEmojiSoundUrl): un asset estático, no algo sintetizado.
const MENTION_SOUND_SRC = '/sounds/mention.mp3';

export function playMentionSound(): void {
  if (typeof window === 'undefined' || !isMentionSoundEnabled()) return;
  void new Audio(MENTION_SOUND_SRC).play().catch(() => undefined);
}
