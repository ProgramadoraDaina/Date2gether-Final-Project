export type ShortcutAction = 'microphone' | 'camera' | 'hand' | 'help';

export const SHORTCUTS: { action: ShortcutAction; keys: string; label: string }[] = [
  { action: 'microphone', keys: 'Ctrl + D', label: 'Activar o desactivar el micrófono' },
  { action: 'camera', keys: 'Ctrl + E', label: 'Activar o desactivar la cámara' },
  { action: 'hand', keys: 'Ctrl + Alt + H', label: 'Levantar o bajar la mano' },
  { action: 'help', keys: '?', label: 'Ver los atajos de teclado' },
];

type KeyInput = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'> & {
  target: EventTarget | null;
};

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

// Mismas teclas que Meet; nunca se disparan mientras alguien escribe en el chat o un formulario.
export function shortcutFor(event: KeyInput): ShortcutAction | null {
  if (isTyping(event.target)) return null;
  const key = event.key.toLowerCase();
  const command = event.ctrlKey || event.metaKey;
  if (command && event.altKey && key === 'h') return 'hand';
  if (command && !event.altKey && key === 'd') return 'microphone';
  if (command && !event.altKey && key === 'e') return 'camera';
  if (!command && !event.altKey && event.key === '?') return 'help';
  return null;
}
