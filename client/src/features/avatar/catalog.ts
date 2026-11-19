// Ids iguales a src/modules/auth/avatar.ts del backend, que valida contra ellos.
// Dibujo en viewBox 0 0 320 300: cabeza centro (160,118) r56, cuerpo desde y≈184.
export const AVATAR_SLOTS = ['head', 'face', 'neck'] as const;
export type AvatarSlot = (typeof AVATAR_SLOTS)[number];

export interface AvatarPiece {
  label: string;
  color: string;
  svg: string;
  talks?: boolean;
}

export const HEAD_PIECES = {
  cap: {
    label: 'Gorra',
    color: '#3d7be0',
    svg: `
      <path class="f" d="M150 98 C186 92 234 92 260 102 C252 114 224 118 192 114 C174 112 160 108 150 104 Z"/>
      <path class="f" d="M104 102 C104 54 130 38 160 38 C190 38 216 54 216 102 Q160 92 104 102 Z"/>
      <path class="o thin" d="M160 40 C152 58 150 78 152 96"/>
      <circle class="f" cx="160" cy="38" r="5"/>`,
  },
  propeller: {
    label: 'Hélice',
    color: '#3d7be0',
    svg: `
      <path class="f" d="M106 100 C106 54 130 42 160 42 C190 42 214 54 214 100 Z"/>
      <rect class="k" x="157" y="24" width="6" height="20"/>
      <g class="spin">
        <ellipse cx="139" cy="24" rx="21" ry="6" style="fill:#f2c14e"/>
        <ellipse cx="181" cy="24" rx="21" ry="6" style="fill:#e04b3a"/>
      </g>
      <circle class="k" cx="160" cy="24" r="5"/>`,
  },
  sprout: {
    label: 'Brote',
    color: '#2fa36b',
    svg: `
      <g class="pom">
        <path class="o" d="M160 64 Q156 48 160 32" style="stroke-width:11px"/>
        <path class="o ns" d="M160 64 Q156 48 160 32" style="stroke:var(--c);stroke-width:5px"/>
        <path class="f" d="M160 36 C146 20 126 22 120 32 C132 44 150 44 160 36 Z"/>
        <path class="f" d="M160 32 C170 14 192 12 200 22 C190 36 172 38 160 32 Z"/>
      </g>`,
  },
  chef: {
    label: 'Chef',
    color: '#f2f0ea',
    svg: `
      <path class="f" d="M114 72 C92 68 90 36 114 34 C110 8 146 2 160 18 C174 2 210 8 206 34 C230 36 228 68 206 72 Z"/>
      <path class="o thin" d="M128 52 C132 44 140 40 148 42 M178 30 C186 30 192 36 192 44"/>
      <path class="f" d="M116 66 H204 V94 Q160 102 116 94 Z"/>`,
  },
  cowboy: {
    label: 'Vaquero',
    color: '#a0673a',
    svg: `
      <path class="f" d="M120 88 C116 52 126 36 140 40 Q160 50 180 40 C194 36 204 52 200 88 Z"/>
      <path class="k" d="M119 76 Q160 84 201 76 L201 88 Q160 96 119 88 Z"/>
      <path class="f" d="M78 80 Q100 98 160 98 Q220 98 242 80 Q238 104 160 106 Q82 104 78 80 Z"/>`,
  },
  catEars: {
    label: 'Orejas de gato',
    color: '#5a5a5a',
    svg: `
      <path class="f" d="M111 94 L96 40 L144 64 Z"/>
      <path class="f" d="M209 94 L224 40 L176 64 Z"/>
      <path class="ns" d="M113 81 L104 52 L131 66 Z" style="fill:#f08aa0"/>
      <path class="ns" d="M207 81 L216 52 L189 66 Z" style="fill:#f08aa0"/>`,
  },
  viking: {
    label: 'Vikingo',
    color: '#9aa3ab',
    svg: `
      <path d="M108 86 C88 82 76 60 84 34 C92 54 104 62 118 66 Z" style="fill:#f2f0ea"/>
      <path d="M212 86 C232 82 244 60 236 34 C228 54 216 62 202 66 Z" style="fill:#f2f0ea"/>
      <path class="f" d="M104 100 C104 50 130 38 160 38 C190 38 216 50 216 100 Z"/>
      <rect x="102" y="88" width="116" height="14" style="fill:#6b4428"/>
      <circle class="w ns" cx="124" cy="95" r="3"/><circle class="w ns" cx="160" cy="95" r="3"/><circle class="w ns" cx="196" cy="95" r="3"/>`,
  },
  flower: {
    label: 'Flor',
    color: '#f08aa0',
    svg: `
      <g class="pom">
        <circle class="f" cx="198" cy="56" r="11"/>
        <circle class="f" cx="211" cy="65" r="11"/>
        <circle class="f" cx="206" cy="80" r="11"/>
        <circle class="f" cx="190" cy="80" r="11"/>
        <circle class="f" cx="185" cy="65" r="11"/>
        <circle cx="198" cy="69" r="8" style="fill:#f2c14e"/>
      </g>`,
  },
  tophat: {
    label: 'Galera',
    color: '#2b2b2b',
    svg: `
      <ellipse class="f" cx="160" cy="76" rx="76" ry="12"/>
      <rect class="f" x="120" y="6" width="80" height="70"/>
      <rect class="w" x="120" y="54" width="80" height="12"/>`,
  },
  crown: {
    label: 'Corona',
    color: '#f2c14e',
    svg: `
      <path class="f" d="M112 88 L112 42 L136 64 L160 32 L184 64 L208 42 L208 88 Z"/>
      <path class="o thin" d="M112 76 H208"/>
      <circle class="w" cx="160" cy="32" r="6"/><circle class="w" cx="112" cy="42" r="5"/><circle class="w" cx="208" cy="42" r="5"/>`,
  },
  beanie: {
    label: 'Gorro de lana',
    color: '#e04b3a',
    svg: `
      <path class="f" d="M106 100 C106 50 130 36 160 36 C190 36 214 50 214 100 Z"/>
      <rect class="f" x="100" y="90" width="120" height="22"/>
      <path class="o thin" d="M120 92 V112 M140 92 V112 M160 92 V112 M180 92 V112 M200 92 V112"/>
      <circle class="w pom" cx="160" cy="30" r="14"/>`,
  },
  party: {
    label: 'Cumpleaños',
    color: '#8a4fd8',
    svg: `
      <path class="f" d="M124 88 L160 10 L196 88 Z"/>
      <path class="o thin" d="M139 56 L181 56 M131 72 L189 72"/>
      <circle class="w pom" cx="160" cy="10" r="10"/>`,
  },
  horns: {
    label: 'Cuernitos',
    color: '#e04b3a',
    svg: `
      <path class="f" d="M116 88 C102 66 102 44 112 26 C120 46 128 60 142 72 Z"/>
      <path class="f" d="M204 88 C218 66 218 44 208 26 C200 46 192 60 178 72 Z"/>`,
  },
  halo: {
    label: 'Aureola',
    color: '#f2c14e',
    svg: `
      <ellipse class="o" cx="160" cy="40" rx="50" ry="12" style="stroke-width:14px"/>
      <ellipse class="o ns" cx="160" cy="40" rx="50" ry="12" style="stroke:var(--c);stroke-width:7px"/>`,
  },
  headphones: {
    label: 'Auriculares',
    color: '#f2f0ea',
    svg: `
      <path class="o" d="M98 122 Q98 46 160 46 Q222 46 222 122" style="stroke-width:14px"/>
      <path class="o ns" d="M98 122 Q98 46 160 46 Q222 46 222 122" style="stroke:var(--c);stroke-width:7px"/>
      <rect class="f" x="86" y="104" width="24" height="42"/>
      <rect class="f" x="210" y="104" width="24" height="42"/>`,
  },
  bow: {
    label: 'Moño',
    color: '#f08aa0',
    svg: `
      <g transform="rotate(-18 196 70)">
        <path class="f" d="M196 70 L166 52 L168 90 Z"/>
        <path class="f" d="M196 70 L226 52 L224 90 Z"/>
        <circle class="f" cx="196" cy="70" r="8"/>
      </g>`,
  },
  egg: {
    label: 'Huevo frito',
    color: '#f2f0ea',
    svg: `
      <path class="f" d="M101 94 C98 66 124 50 160 50 C196 50 222 66 219 94 C219 102 211 103 209 96 C206 88 199 90 199 99 C199 113 187 113 187 100 C186 91 176 92 170 96 C164 100 152 100 147 95 C141 89 133 92 132 102 C131 114 119 114 119 101 C119 92 111 90 109 97 C107 103 101 102 101 94 Z"/>
      <ellipse cx="160" cy="48" rx="25" ry="21" style="fill:#f08a24"/>
      <ellipse class="w ns" cx="151" cy="40" rx="8" ry="5" style="opacity:.85"/>`,
  },
  cheese: {
    label: 'Queso',
    color: '#f2c14e',
    svg: `
      <g transform="rotate(-10 160 96)">
        <path d="M108 16 L214 98 L230 84 L124 4 Z" style="fill:#ffe17a"/>
        <path class="f" d="M108 98 L214 98 L108 16 Z"/>
        <ellipse class="ns" cx="150" cy="34" rx="10" ry="4" transform="rotate(38 150 34)" style="fill:#d99a1e"/>
        <ellipse class="ns" cx="194" cy="70" rx="7" ry="3" transform="rotate(38 194 70)" style="fill:#d99a1e"/>
        <circle class="thin" cx="134" cy="76" r="14" style="fill:#d99a1e"/>
        <circle class="thin" cx="124" cy="42" r="8" style="fill:#d99a1e"/>
        <circle class="thin" cx="166" cy="88" r="6" style="fill:#d99a1e"/>
        <circle class="thin" cx="148" cy="56" r="5" style="fill:#d99a1e"/>
        <circle class="thin" cx="184" cy="88" r="4" style="fill:#d99a1e"/>
      </g>`,
  },
  flamingo: {
    label: 'Flamenco',
    color: '#f08aa0',
    svg: `
      <path class="o" d="M200 84 C218 66 218 46 204 38 C192 31 190 22 198 18" style="stroke-width:22px"/>
      <circle class="k ns" cx="198" cy="18" r="16"/>
      <path class="o ns" d="M200 84 C218 66 218 46 204 38 C192 31 190 22 198 18" style="stroke:var(--c);stroke-width:12px"/>
      <circle class="ns" cx="198" cy="18" r="11.5" style="fill:var(--c)"/>
      <path d="M188 14 C176 14 168 20 166 30 C174 26 182 24 190 24 Z" style="fill:#f2f0ea"/>
      <path class="k ns" d="M170 22 C167 24 166 27 166 30 C169 28 171 27 174 26 Z"/>
      <circle class="k ns" cx="201" cy="13" r="2.5"/>
      <ellipse class="f" cx="160" cy="88" rx="76" ry="36"/>
      <ellipse cx="160" cy="80" rx="42" ry="12" style="fill:var(--sil)"/>
      <path class="ns" d="M118 80 C122 90 198 90 202 80 C196 86 124 86 118 80 Z" style="fill:rgba(0,0,0,.22)"/>
      <path class="o ns" d="M98 80 Q104 62 126 56" style="stroke:#f2f0ea;stroke-width:5px"/>
      <path class="o ns" d="M200 112 Q218 108 226 98" style="stroke:#f2f0ea;stroke-width:4px;opacity:.7"/>
      <path class="o ns" d="M116 104 Q122 112 132 116 M186 116 Q196 112 202 106" style="stroke:rgba(0,0,0,.18);stroke-width:3px"/>`,
  },
  toiletPaper: {
    label: 'Papel higiénico',
    color: '#f2f0ea',
    svg: `
      <path class="f" d="M128 34 L110 38 L110 76 L116 71 L121 77 L126 71 L128 74 Z"/>
      <path class="f" d="M128 22 V68 Q160 80 192 68 V22 Z"/>
      <ellipse class="f" cx="160" cy="22" rx="32" ry="9"/>
      <ellipse class="k ns" cx="160" cy="22" rx="10" ry="4"/>`,
  },
} satisfies Record<string, AvatarPiece>;

export const FACE_PIECES = {
  mustache: {
    label: 'Bigote',
    color: '#6b4428',
    talks: true,
    svg: `<path class="f" d="M160 134 Q146 124 132 130 Q118 136 112 152 Q126 146 140 148 Q152 150 160 142 Q168 150 180 148 Q194 146 208 152 Q202 136 188 130 Q174 124 160 134 Z"/>`,
  },
  curly: {
    label: 'Bigote con rulos',
    color: '#1c1c1c',
    talks: true,
    svg: `<path class="f" d="M160 136 Q140 126 124 136 Q110 146 114 158 Q122 166 130 158 Q124 150 132 146 Q146 142 160 146 Q174 142 188 146 Q196 150 190 158 Q198 166 206 158 Q210 146 196 136 Q180 126 160 136 Z"/>`,
  },
  beard: {
    label: 'Barba',
    color: '#6b4428',
    talks: true,
    svg: `
      <path class="f" d="M104 116 Q104 196 160 196 Q216 196 216 116 Q206 148 160 148 Q114 148 104 116 Z"/>
      <path class="f" d="M160 140 Q146 130 132 136 Q122 142 120 150 Q140 150 160 146 Q180 150 200 150 Q198 142 188 136 Q174 130 160 140 Z"/>`,
  },
  glasses: {
    label: 'Anteojos',
    color: '#1c1c1c',
    svg: `
      <circle cx="137" cy="112" r="17" style="fill:rgba(255,255,255,.18);stroke:var(--c)"/>
      <circle cx="183" cy="112" r="17" style="fill:rgba(255,255,255,.18);stroke:var(--c)"/>
      <path class="o" d="M154 110 Q160 104 166 110 M120 108 L106 104 M200 108 L214 104" style="stroke:var(--c)"/>`,
  },
  sunglasses: {
    label: 'Lentes de sol',
    color: '#1c1c1c',
    svg: `
      <path class="f" d="M112 100 H156 L152 124 Q146 132 134 132 Q116 130 114 116 Z"/>
      <path class="f" d="M208 100 H164 L168 124 Q174 132 186 132 Q204 130 206 116 Z"/>
      <path class="o" d="M156 104 H164"/>
      <path class="o ns" d="M122 108 L132 104 M174 108 L184 104" style="stroke:#f2f0ea;stroke-width:3px"/>`,
  },
  pixel: {
    label: 'Lentes pixel',
    color: '#1c1c1c',
    svg: `
      <path class="f" d="M104 100 H216 V108 H208 V116 H200 V124 H174 V116 H166 V108 H154 V116 H146 V124 H120 V116 H112 V108 H104 Z"/>
      <rect class="w ns" x="124" y="108" width="7" height="7"/><rect class="w ns" x="178" y="108" width="7" height="7"/>`,
  },
  glasses3d: {
    label: 'Lentes 3D',
    color: '#f2f0ea',
    svg: `
      <path class="f" d="M108 98 H212 V128 H174 L160 118 L146 128 H108 Z"/>
      <rect class="ns" x="116" y="104" width="34" height="17" style="fill:#e04b3a"/>
      <rect class="ns" x="170" y="104" width="34" height="17" style="fill:#3d7be0"/>`,
  },
  hearts: {
    label: 'Corazones',
    color: '#e04b3a',
    svg: `
      <path class="f" d="M136 126 C112 112 118 94 136 104 C154 94 160 112 136 126 Z"/>
      <path class="f" d="M184 126 C160 112 166 94 184 104 C202 94 208 112 184 126 Z"/>
      <path class="o" d="M150 106 Q160 100 170 106"/>`,
  },
  stars: {
    label: 'Estrellas',
    color: '#f2c14e',
    svg: `
      <path class="f" d="M136 94 L140.7 105.5 L153.1 106.4 L143.6 114.5 L146.6 126.6 L136 120 L125.4 126.6 L128.4 114.5 L118.9 106.4 L131.3 105.5 Z"/>
      <path class="f" d="M184 94 L188.7 105.5 L201.1 106.4 L191.6 114.5 L194.6 126.6 L184 120 L173.4 126.6 L176.4 114.5 L166.9 106.4 L179.3 105.5 Z"/>
      <path class="o" d="M152 108 H168"/>`,
  },
  nerd: {
    label: 'Nerd',
    color: '#1c1c1c',
    svg: `
      <rect x="114" y="98" width="42" height="28" style="fill:rgba(255,255,255,.18);stroke:var(--c);stroke-width:7px"/>
      <rect x="164" y="98" width="42" height="28" style="fill:rgba(255,255,255,.18);stroke:var(--c);stroke-width:7px"/>
      <path class="o" d="M156 108 H164" style="stroke:var(--c);stroke-width:7px"/>
      <rect class="w" x="153" y="102" width="14" height="14"/>`,
  },
  monocle: {
    label: 'Monóculo',
    color: '#f2c14e',
    svg: `
      <circle cx="183" cy="112" r="18" style="fill:rgba(255,255,255,.18);stroke:var(--c);stroke-width:6px"/>
      <path class="o thin" d="M200 120 Q218 150 198 186" style="stroke:var(--c)"/>`,
  },
  mask: {
    label: 'Antifaz',
    color: '#1c1c1c',
    svg: `
      <path class="f" d="M104 104 Q160 86 216 104 Q218 124 198 128 Q178 130 168 116 Q160 110 152 116 Q142 130 122 128 Q102 124 104 104 Z"/>
      <ellipse class="ns" cx="134" cy="110" rx="10" ry="6" style="fill:var(--sil)"/>
      <ellipse class="ns" cx="186" cy="110" rx="10" ry="6" style="fill:var(--sil)"/>`,
  },
  blush: {
    label: 'Cachetes',
    color: '#f08aa0',
    svg: `
      <ellipse class="f ns" cx="126" cy="134" rx="11" ry="7" style="opacity:.8"/>
      <ellipse class="f ns" cx="194" cy="134" rx="11" ry="7" style="opacity:.8"/>`,
  },
  postit: {
    label: 'Post-it',
    color: '#f2c14e',
    svg: `
      <g transform="rotate(-10 168 112)">
        <path class="f" d="M138 84 H198 V130 L186 142 H138 Z"/>
        <path class="ns" d="M198 130 L186 130 L186 142 Z" style="fill:rgba(0,0,0,.18)"/>
        <text class="ink" x="166" y="120" text-anchor="middle">DUMB</text>
      </g>`,
  },
} satisfies Record<string, AvatarPiece>;

export const NECK_PIECES = {
  bowtie: {
    label: 'Moño de corbata',
    color: '#e04b3a',
    svg: `
      <path class="f" d="M160 202 L130 186 L130 218 Z"/>
      <path class="f" d="M160 202 L190 186 L190 218 Z"/>
      <rect class="f" x="152" y="194" width="16" height="16"/>`,
  },
  tie: {
    label: 'Corbata',
    color: '#3d7be0',
    svg: `
      <path class="f" d="M150 192 H170 L165 206 H155 Z"/>
      <path class="f" d="M155 206 L148 252 L160 266 L172 252 L165 206 Z"/>`,
  },
  chain: {
    label: 'Cadena',
    color: '#f2c14e',
    svg: `
      <path class="o" d="M116 196 Q160 246 204 196" style="stroke-width:11px"/>
      <path class="o ns" d="M116 196 Q160 246 204 196" style="stroke:var(--c);stroke-width:5px"/>
      <circle class="f" cx="160" cy="232" r="12"/>`,
  },
  scarf: {
    label: 'Bufanda',
    color: '#e04b3a',
    svg: `
      <path class="f" d="M104 188 Q160 214 216 188 L218 208 Q160 234 102 208 Z"/>
      <path class="f" d="M176 212 L190 260 L172 262 L162 216 Z"/>`,
  },
} satisfies Record<string, AvatarPiece>;

export type HeadId = keyof typeof HEAD_PIECES;
export type FaceId = keyof typeof FACE_PIECES;
export type NeckId = keyof typeof NECK_PIECES;

export const PIECES: Record<AvatarSlot, Record<string, AvatarPiece>> = {
  head: HEAD_PIECES,
  face: FACE_PIECES,
  neck: NECK_PIECES,
};

export const SLOT_LABELS: Record<AvatarSlot, string> = {
  head: 'Cabeza',
  face: 'Cara',
  neck: 'Cuello',
};

export const AVATAR_PALETTE = [
  '#e04b3a',
  '#f2c14e',
  '#3d7be0',
  '#2fa36b',
  '#8a4fd8',
  '#f08aa0',
  '#6b4428',
  '#f2f0ea',
  '#1c1c1c',
];

export interface Avatar {
  head?: HeadId;
  face?: FaceId;
  neck?: NeckId;
  colors?: Partial<Record<AvatarSlot, string>>;
  sticker: boolean;
}

export const EMPTY_AVATAR: Avatar = { sticker: true };

const HEX = /^#[0-9a-f]{6}$/i;

export function pieceOf(avatar: Avatar, slot: AvatarSlot): AvatarPiece | undefined {
  const id = avatar[slot];
  return id ? PIECES[slot][id] : undefined;
}

export function colorOf(avatar: Avatar, slot: AvatarSlot): string | undefined {
  const own = avatar.colors?.[slot];
  return own && HEX.test(own) ? own : pieceOf(avatar, slot)?.color;
}

// Lo que llega de otros por socket se limpia igual que en el backend.
export function toAvatar(input: unknown): Avatar | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const avatar: Avatar = { sticker: raw.sticker !== false };
  const rawColors = (raw.colors ?? {}) as Record<string, unknown>;
  const colors: Partial<Record<AvatarSlot, string>> = {};
  for (const slot of AVATAR_SLOTS) {
    const id = raw[slot];
    if (typeof id !== 'string' || !(id in PIECES[slot])) continue;
    (avatar as unknown as Record<string, string>)[slot] = id;
    const color = rawColors[slot];
    if (typeof color === 'string' && HEX.test(color)) colors[slot] = color.toLowerCase();
  }
  if (Object.keys(colors).length > 0) avatar.colors = colors;
  return avatar;
}

export function withPiece(avatar: Avatar, slot: AvatarSlot, id: string | undefined): Avatar {
  const next: Avatar = { ...avatar, colors: { ...avatar.colors } };
  delete next.colors![slot];
  if (id) (next as unknown as Record<string, string>)[slot] = id;
  else delete next[slot];
  if (Object.keys(next.colors!).length === 0) delete next.colors;
  return next;
}

export function withColor(avatar: Avatar, slot: AvatarSlot, color: string): Avatar {
  return { ...avatar, colors: { ...avatar.colors, [slot]: color.toLowerCase() } };
}

export function randomAvatar(sticker: boolean, random: () => number = Math.random): Avatar {
  const pick = (ids: string[]) => ids[Math.floor(random() * ids.length)];
  return {
    head: pick(Object.keys(HEAD_PIECES)) as HeadId,
    face: pick(Object.keys(FACE_PIECES)) as FaceId,
    neck: random() < 0.5 ? undefined : (pick(Object.keys(NECK_PIECES)) as NeckId),
    sticker,
  };
}
