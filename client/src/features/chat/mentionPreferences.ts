// Preferencia puramente local (ni cuenta ni sala): "no me gusta ese
// sonido" es sobre esta máquina/navegador, no algo que vaya en el backend.
const MENTION_SOUND_KEY = 'date2gether:mentionSoundEnabled';

export function isMentionSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(MENTION_SOUND_KEY) !== 'false';
}

export function setMentionSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MENTION_SOUND_KEY, String(enabled));
}
