// Ids del catálogo de accesorios: el frontend dibuja exactamente estas piezas
// (client/src/features/avatar/catalog.ts).
export const AVATAR_HEAD_IDS = [
  'cap',
  'propeller',
  'sprout',
  'chef',
  'cowboy',
  'catEars',
  'viking',
  'flower',
  'tophat',
  'crown',
  'beanie',
  'party',
  'horns',
  'halo',
  'headphones',
  'bow',
  'egg',
  'cheese',
  'flamingo',
  'toiletPaper',
  'deadpool',
  'spiderman',
  'ironman',
  'captain',
  'wolverine',
  'loki',
  'magneto',
  'doom',
  'tiara',
  'rose',
  'hairShort',
  'hairLong',
] as const;

export const AVATAR_FACE_IDS = [
  'mustache',
  'curly',
  'beard',
  'glasses',
  'sunglasses',
  'pixel',
  'glasses3d',
  'hearts',
  'stars',
  'nerd',
  'monocle',
  'mask',
  'blush',
  'postit',
  'eyelashes',
] as const;

export const AVATAR_NECK_IDS = ['bowtie', 'tie', 'chain', 'scarf', 'strange', 'necklace'] as const;

export const AVATAR_BODY_IDS = ['blouse', 'sweetheartTop'] as const;

export const AVATAR_SLOTS = ['body', 'head', 'face', 'neck'] as const;
export type AvatarSlot = (typeof AVATAR_SLOTS)[number];

export const AVATAR_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export interface UserAvatar {
  body?: Array<(typeof AVATAR_BODY_IDS)[number]>;
  head?: Array<(typeof AVATAR_HEAD_IDS)[number]>;
  face?: Array<(typeof AVATAR_FACE_IDS)[number]>;
  neck?: Array<(typeof AVATAR_NECK_IDS)[number]>;
  // Clave "<slot>:<id>": cada pieza seleccionada tiene su propio color (con
  // dos piezas en el mismo slot, p. ej. corona + tiara, cada una se recolorea
  // por separado). Se antepone el slot al id por si algún día dos slots
  // comparten un id de pieza; hoy no pasa (ver IDS_BY_SLOT) pero igual
  // conviene no depender de que los ids sean únicos en todo el catálogo.
  colors?: Partial<Record<string, string>>;
  sticker: boolean;
}

const IDS_BY_SLOT: Record<AvatarSlot, readonly string[]> = {
  body: AVATAR_BODY_IDS,
  head: AVATAR_HEAD_IDS,
  face: AVATAR_FACE_IDS,
  neck: AVATAR_NECK_IDS,
};

export function avatarColorKey(slot: AvatarSlot, id: string): string {
  return `${slot}:${id}`;
}

// Para lo que llega por el socket, donde no corre el ValidationPipe: descarta
// todo lo que no sea del catálogo en vez de rechazar el avatar entero.
// También acepta el string suelto que guardaban las cuentas viejas (un solo
// id por slot, con colors[slot] en vez de colors["slot:id"]) y lo convierte
// al array/color-por-pieza nuevo, para no perder esos datos al leerlos.
export function sanitizeAvatar(input: unknown): UserAvatar | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const avatar: UserAvatar = { sticker: raw.sticker !== false };
  const colors: Partial<Record<string, string>> = {};
  const rawColors = (raw.colors && typeof raw.colors === 'object' ? raw.colors : {}) as Record<
    string,
    unknown
  >;

  for (const slot of AVATAR_SLOTS) {
    const rawValue = raw[slot];
    const candidates = Array.isArray(rawValue)
      ? rawValue
      : rawValue !== undefined
        ? [rawValue]
        : [];
    const ids = candidates.filter(
      (id): id is string => typeof id === 'string' && IDS_BY_SLOT[slot].includes(id),
    );
    if (ids.length > 0) (avatar as unknown as Record<string, string[]>)[slot] = ids;

    for (const id of ids) {
      const key = avatarColorKey(slot, id);
      const color = rawColors[key];
      if (typeof color === 'string' && AVATAR_COLOR_PATTERN.test(color)) {
        colors[key] = color.toLowerCase();
      }
    }
    // Compat con avatares viejos guardados con un solo color por slot:
    // se lo asigna a la única pieza que ese slot tenía en ese momento.
    if (ids.length === 1 && colors[avatarColorKey(slot, ids[0])] === undefined) {
      const legacy = rawColors[slot];
      if (typeof legacy === 'string' && AVATAR_COLOR_PATTERN.test(legacy)) {
        colors[avatarColorKey(slot, ids[0])] = legacy.toLowerCase();
      }
    }
  }
  if (Object.keys(colors).length > 0) avatar.colors = colors;
  return avatar;
}
