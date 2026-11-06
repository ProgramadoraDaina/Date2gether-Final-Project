import { NAME_COLOR_HEX, NAME_COLOR_IDS, isNameColorId, type NameColorId } from '@/lib/nameColors';
import styles from './InitialsAvatar.module.css';

// Hash FNV-1a de 32 bits: estable entre renders y sesiones, solo decide qué
// color de la paleta existente le toca a un nombre que no trae `nameColor`
// propio (invitados, o cuentas que nunca eligieron uno en /settings).
function colorIndexFor(name: string, modulo: number): number {
  let hash = 0x811c9dc5;
  for (const char of name) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash) % modulo;
}

// `Array.from()` en vez de `slice`/`charAt`: no corta un carácter Unicode
// compuesto (acentos, emoji) a la mitad. 1 palabra -> su primera letra;
// 2+ palabras -> primera letra de las dos primeras, el resto se ignora.
function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? '')
    .join('');
}

interface InitialsAvatarProps {
  name: string;
  // Color ya elegido del lado del servidor (paleta de 8 colores existente,
  // misma que usa el chat de la sala); si no viene o no es válido, se deriva
  // un color estable a partir del propio nombre.
  nameColor?: string | null;
}

export function InitialsAvatar({ name, nameColor }: InitialsAvatarProps) {
  const colorId: NameColorId =
    nameColor && isNameColorId(nameColor)
      ? nameColor
      : NAME_COLOR_IDS[colorIndexFor(name, NAME_COLOR_IDS.length)];
  return (
    <span
      className={styles.avatar}
      style={{ backgroundColor: NAME_COLOR_HEX[colorId] }}
      data-testid="initials-avatar"
      aria-hidden="true"
    >
      {initialsFor(name)}
    </span>
  );
}
