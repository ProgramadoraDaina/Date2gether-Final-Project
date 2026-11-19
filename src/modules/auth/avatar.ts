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
] as const;

export const AVATAR_NECK_IDS = ['bowtie', 'tie', 'chain', 'scarf'] as const;

export const AVATAR_SLOTS = ['head', 'face', 'neck'] as const;
export type AvatarSlot = (typeof AVATAR_SLOTS)[number];

export const AVATAR_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export interface UserAvatar {
  head?: (typeof AVATAR_HEAD_IDS)[number];
  face?: (typeof AVATAR_FACE_IDS)[number];
  neck?: (typeof AVATAR_NECK_IDS)[number];
  colors?: Partial<Record<AvatarSlot, string>>;
  sticker: boolean;
}

const IDS_BY_SLOT: Record<AvatarSlot, readonly string[]> = {
  head: AVATAR_HEAD_IDS,
  face: AVATAR_FACE_IDS,
  neck: AVATAR_NECK_IDS,
};

// Para lo que llega por el socket, donde no corre el ValidationPipe: descarta
// todo lo que no sea del catálogo en vez de rechazar el avatar entero.
export function sanitizeAvatar(input: unknown): UserAvatar | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const avatar: UserAvatar = { sticker: raw.sticker !== false };
  const colors: Partial<Record<AvatarSlot, string>> = {};
  const rawColors = (raw.colors && typeof raw.colors === 'object' ? raw.colors : {}) as Record<
    string,
    unknown
  >;

  for (const slot of AVATAR_SLOTS) {
    const id = raw[slot];
    if (typeof id !== 'string' || !IDS_BY_SLOT[slot].includes(id)) continue;
    (avatar as unknown as Record<string, string>)[slot] = id;
    const color = rawColors[slot];
    if (typeof color === 'string' && AVATAR_COLOR_PATTERN.test(color)) {
      colors[slot] = color.toLowerCase();
    }
  }
  if (Object.keys(colors).length > 0) avatar.colors = colors;
  return avatar;
}
