// Paleta de 8 colores de nombre: misma paleta e ids que usa el backend para
// validar PATCH /auth/me/color y para lo que transmite por socket
// (roomUsers/userJoined). Compartido entre la sala (chat + presencia) y la
// página de configuración para no duplicar los 8 valores hex en dos lugares.
export type NameColorId =
  | 'purple'
  | 'red'
  | 'teal'
  | 'amber'
  | 'navy'
  | 'orange'
  | 'green'
  | 'pink';

export const NAME_COLOR_HEX: Record<NameColorId, string> = {
  purple: '#9D00FF',
  red: '#E63946',
  teal: '#2A9D8F',
  amber: '#E9A23B',
  navy: '#355C7D',
  orange: '#F4A261',
  green: '#06D6A0',
  pink: '#EF476F',
};

export const NAME_COLOR_IDS = Object.keys(NAME_COLOR_HEX) as NameColorId[];

export function isNameColorId(value: string): value is NameColorId {
  return value in NAME_COLOR_HEX;
}

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

// Misma resolución que usa InitialsAvatar: color propio si vino y es válido,
// si no uno derivado del nombre. Se centraliza acá para que cualquier otra
// vista (como la línea de tiempo) pinte a la misma persona con el mismo
// color sin duplicar el hash.
export function resolveNameColorId(name: string, nameColor?: string | null): NameColorId {
  if (nameColor && isNameColorId(nameColor)) return nameColor;
  return NAME_COLOR_IDS[colorIndexFor(name, NAME_COLOR_IDS.length)];
}
