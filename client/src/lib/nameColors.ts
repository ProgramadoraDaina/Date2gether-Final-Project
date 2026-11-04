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
