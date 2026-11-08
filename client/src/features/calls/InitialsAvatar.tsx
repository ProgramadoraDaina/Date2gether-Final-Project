import { NAME_COLOR_HEX, resolveNameColorId } from '@/lib/nameColors';
import styles from './InitialsAvatar.module.css';

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
  // Tamaño en px. Default 32 (chat/presencia); la línea de tiempo de
  // participación pide uno más grande para leerse como carril, no como ítem
  // de lista de chat.
  size?: number;
}

export function InitialsAvatar({ name, nameColor, size = 32 }: InitialsAvatarProps) {
  const colorId = resolveNameColorId(name, nameColor);
  return (
    <span
      className={styles.avatar}
      style={{
        backgroundColor: NAME_COLOR_HEX[colorId],
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
      }}
      data-testid="initials-avatar"
      aria-hidden="true"
    >
      {initialsFor(name)}
    </span>
  );
}
