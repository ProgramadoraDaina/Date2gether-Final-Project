// Ids iguales a src/modules/auth/avatar.ts del backend, que valida contra ellos.
// Dibujo en viewBox 0 0 320 300: cabeza centro (160,118) r56, cuerpo desde y≈184.
export const AVATAR_SLOTS = ['body', 'head', 'face', 'neck'] as const;
export type AvatarSlot = (typeof AVATAR_SLOTS)[number];

export interface AvatarPiece {
  label: string;
  color: string;
  svg: string;
  // Capa opcional dibujada detrás de la silueta del cuerpo (p. ej. una capa,
  // o el pelo que asoma detrás de los hombros).
  back?: string;
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
  deadpool: {
    label: 'Deadpool',
    color: '#b5121b',
    svg: `
    <circle class="f" cx="160" cy="118" r="58"/>
    <g class="detail" clip-path="url(#headClip)">
      <path class="o thin" d="M160 60 V98 M124 170 Q160 184 196 170" style="stroke:rgba(0,0,0,.45)"/>
      <path class="o ns" d="M116 78 Q134 64 158 64" style="stroke:rgba(255,255,255,.25);stroke-width:5px"/>
    </g>
    <path class="k" d="M104 104 C104 82 132 76 150 94 C160 110 154 134 138 140 C118 146 102 128 104 104 Z"/>
    <path class="k" d="M216 104 C216 82 188 76 170 94 C160 110 166 134 182 140 C202 146 218 128 216 104 Z"/>
    <path class="w blink" d="M116 115 Q130 104 146 115 Q132 123 116 115 Z"/>
    <path class="w blink" d="M204 115 Q190 104 174 115 Q188 123 204 115 Z"/>`,
  },
  spiderman: {
    label: 'Spider-Man',
    color: '#d0142a',
    svg: `
    <circle class="f" cx="160" cy="118" r="58"/>
    <g class="detail" clip-path="url(#headClip)">
      <path class="o" d="M160 108 L160.0 18.0 M160 108 L199.0 26.9 M160 108 L230.4 51.9 M160 108 L247.7 88.0 M160 108 L247.7 128.0 M160 108 L230.4 164.1 M160 108 L199.0 189.1 M160 108 L160.0 198.0 M160 108 L121.0 189.1 M160 108 L89.6 164.1 M160 108 L72.3 128.0 M160 108 L72.3 88.0 M160 108 L89.6 51.9 M160 108 L121.0 26.9 M160.0 92.0 Q163.1 94.6 166.9 93.6 M166.9 93.6 Q168.6 97.2 172.5 98.0 M172.5 98.0 Q172.4 102.0 175.6 104.4 M175.6 104.4 Q173.8 108.0 175.6 111.6 M175.6 111.6 Q172.4 114.0 172.5 118.0 M172.5 118.0 Q168.6 118.8 166.9 122.4 M166.9 122.4 Q163.1 121.4 160.0 124.0 M160.0 124.0 Q156.9 121.4 153.1 122.4 M153.1 122.4 Q151.4 118.8 147.5 118.0 M147.5 118.0 Q147.6 114.0 144.4 111.6 M144.4 111.6 Q146.2 108.0 144.4 104.4 M144.4 104.4 Q147.6 102.0 147.5 98.0 M147.5 98.0 Q151.4 97.2 153.1 93.6 M153.1 93.6 Q156.9 94.6 160.0 92.0 M160.0 77.0 Q165.9 82.0 173.5 80.1 M173.5 80.1 Q176.6 87.2 184.2 88.7 M184.2 88.7 Q184.0 96.4 190.2 101.1 M190.2 101.1 Q186.7 108.0 190.2 114.9 M190.2 114.9 Q184.0 119.6 184.2 127.3 M184.2 127.3 Q176.6 128.8 173.5 135.9 M173.5 135.9 Q165.9 134.0 160.0 139.0 M160.0 139.0 Q154.1 134.0 146.5 135.9 M146.5 135.9 Q143.4 128.8 135.8 127.3 M135.8 127.3 Q136.0 119.6 129.8 114.9 M129.8 114.9 Q133.3 108.0 129.8 101.1 M129.8 101.1 Q136.0 96.4 135.8 88.7 M135.8 88.7 Q143.4 87.2 146.5 80.1 M146.5 80.1 Q154.1 82.0 160.0 77.0 M160.0 60.0 Q169.2 67.8 180.8 64.8 M180.8 64.8 Q185.7 75.7 197.5 78.1 M197.5 78.1 Q197.2 90.1 206.8 97.3 M206.8 97.3 Q201.3 108.0 206.8 118.7 M206.8 118.7 Q197.2 125.9 197.5 137.9 M197.5 137.9 Q185.7 140.3 180.8 151.2 M180.8 151.2 Q169.2 148.2 160.0 156.0 M160.0 156.0 Q150.8 148.2 139.2 151.2 M139.2 151.2 Q134.3 140.3 122.5 137.9 M122.5 137.9 Q122.8 125.9 113.2 118.7 M113.2 118.7 Q118.7 108.0 113.2 97.3 M113.2 97.3 Q122.8 90.1 122.5 78.1 M122.5 78.1 Q134.3 75.7 139.2 64.8 M139.2 64.8 Q150.8 67.8 160.0 60.0 M160.0 40.0 Q173.0 51.0 189.5 46.7 M189.5 46.7 Q196.5 62.3 213.2 65.6 M213.2 65.6 Q212.7 82.6 226.3 92.9 M226.3 92.9 Q218.5 108.0 226.3 123.1 M226.3 123.1 Q212.7 133.4 213.2 150.4 M213.2 150.4 Q196.5 153.7 189.5 169.3 M189.5 169.3 Q173.0 165.0 160.0 176.0 M160.0 176.0 Q147.0 165.0 130.5 169.3 M130.5 169.3 Q123.5 153.7 106.8 150.4 M106.8 150.4 Q107.3 133.4 93.7 123.1 M93.7 123.1 Q101.5 108.0 93.7 92.9 M93.7 92.9 Q107.3 82.6 106.8 65.6 M106.8 65.6 Q123.5 62.3 130.5 46.7 M130.5 46.7 Q147.0 51.0 160.0 40.0 M160.0 18.0 Q177.2 32.5 199.0 26.9 M199.0 26.9 Q208.3 47.5 230.4 51.9 M230.4 51.9 Q229.7 74.4 247.7 88.0 M247.7 88.0 Q237.4 108.0 247.7 128.0 M247.7 128.0 Q229.7 141.6 230.4 164.1 M230.4 164.1 Q208.3 168.5 199.0 189.1 M199.0 189.1 Q177.2 183.5 160.0 198.0 M160.0 198.0 Q142.8 183.5 121.0 189.1 M121.0 189.1 Q111.7 168.5 89.6 164.1 M89.6 164.1 Q90.3 141.6 72.3 128.0 M72.3 128.0 Q82.6 108.0 72.3 88.0 M72.3 88.0 Q90.3 74.4 89.6 51.9 M89.6 51.9 Q111.7 47.5 121.0 26.9 M121.0 26.9 Q142.8 32.5 160.0 18.0" style="stroke-width:2px"/>
    </g>
    <path class="w" d="M150 104 C140 92 118 86 108 92 C102 108 108 124 122 130 C138 134 152 126 154 114 C154 110 152 106 150 104 Z" style="stroke-width:8px"/>
    <path class="w" d="M170 104 C180 92 202 86 212 92 C218 108 212 124 198 130 C182 134 168 126 166 114 C166 110 168 106 170 104 Z" style="stroke-width:8px"/>`,
  },
  ironman: {
    label: 'Iron Man',
    color: '#b3191e',
    svg: `
    <path class="f" d="M102 124 C98 72 126 56 160 56 C194 56 222 72 218 124 L212 156 Q200 178 160 182 Q120 178 108 156 Z"/>
    <path class="o thin" d="M124 70 Q140 62 160 62 Q180 62 196 70"/>
    <path d="M114 96 Q122 84 140 86 L160 94 L180 86 Q198 84 206 96 L204 132 Q200 150 188 162 L178 172 Q160 180 142 172 L132 162 Q120 150 116 132 Z" style="fill:#e8b62c"/>
    <path class="o thin" d="M128 134 L138 158 M192 134 L182 158 M160 94 V104"/>
    <path class="thin blink" d="M124 113 L153 117 L151 125 L128 122 Z" style="fill:#c8fbff"/>
    <path class="thin blink" d="M196 113 L167 117 L169 125 L192 122 Z" style="fill:#c8fbff"/>
    <path class="o" d="M146 160 H174"/>
    <path class="o thin" d="M146 160 L144 166 M174 160 L176 166"/>`,
  },
  captain: {
    label: 'Capitán América',
    color: '#1f4fbf',
    svg: `
    <path class="w" d="M108 116 C94 112 84 100 84 84 C90 90 96 92 102 92 C96 84 96 74 100 66 C106 78 112 88 120 96 Z"/>
    <path class="w" d="M212 116 C226 112 236 100 236 84 C230 90 224 92 218 92 C224 84 224 74 220 66 C214 78 208 88 200 96 Z"/>
    <path class="f" d="M100 146 C94 74 124 54 160 54 C196 54 226 74 220 146 L206 152 Q196 136 160 134 Q124 136 114 152 Z"/>
    <path class="thin" d="M122 114 Q136 102 154 112 Q140 124 122 114 Z" style="fill:var(--sil)"/>
    <path class="thin" d="M198 114 Q184 102 166 112 Q180 124 198 114 Z" style="fill:var(--sil)"/>
    <path class="w" style="fill-rule:evenodd;stroke-width:3px" d="M160 60 L182 102 H169 L165 93 H155 L151 102 H138 Z M160 74 L157 84 H163 Z"/>`,
  },
  wolverine: {
    label: 'Wolverine',
    color: '#f2c318',
    svg: `
    <path class="f" d="M102 140 C98 74 126 58 160 58 C194 58 222 74 218 140 L204 148 Q198 132 160 130 Q122 132 116 148 Z"/>
    <path class="k" d="M156 122 C138 126 114 124 104 114 C94 94 82 66 74 36 C96 62 122 82 156 98 Z"/>
    <path class="k" d="M164 122 C182 126 206 124 216 114 C226 94 238 66 246 36 C224 62 198 82 164 98 Z"/>
    <path class="w" d="M118 110 Q134 104 152 113 Q134 120 118 110 Z"/>
    <path class="w" d="M202 110 Q186 104 168 113 Q186 120 202 110 Z"/>`,
  },
  loki: {
    label: 'Loki',
    color: '#d4a531',
    svg: `
    <path class="f" d="M104 108 C90 84 86 50 96 16 C102 -6 114 -26 128 -40 C120 -20 112 2 110 22 C108 50 112 76 124 98 Z"/>
    <path class="f" d="M216 108 C230 84 234 50 224 16 C218 -6 206 -26 192 -40 C200 -20 208 2 210 22 C212 50 208 76 196 98 Z"/>
    <path class="o ns" d="M110 96 C98 70 96 40 104 12 C108 -4 116 -18 124 -30 M210 96 C222 70 224 40 216 12 C212 -4 204 -18 196 -30" style="stroke:#f6dc8a;stroke-width:3px"/>
    <path class="f" d="M102 104 Q160 74 218 104 L216 116 Q160 88 104 116 Z"/>
    <path class="f" d="M148 90 L160 78 L172 90 L160 112 Z"/>
    <path class="o thin" d="M160 82 V106"/>`,
  },
  magneto: {
    label: 'Magneto',
    color: '#b3191e',
    svg: `
    <path class="f" d="M98 168 C88 72 120 46 160 46 C200 46 232 72 222 168 L204 172 C210 152 210 130 208 116 L198 92 Q178 80 164 104 L160 116 L156 104 Q142 80 122 92 L112 116 C110 130 110 152 116 172 Z"/>
    <path class="o ns" d="M116 172 C110 152 110 130 112 116 L122 92 Q142 80 156 104 L160 116 L164 104 Q178 80 198 92 L208 116 C210 130 210 152 204 172" style="stroke:#5b2d8e;stroke-width:7px"/>
    <path class="thin" d="M150 66 L138 56 L148 72 Z" style="fill:#5b2d8e"/>
    <path class="thin" d="M150 76 L136 74 L150 82 Z" style="fill:#5b2d8e"/>
    <path class="thin" d="M170 66 L182 56 L172 72 Z" style="fill:#5b2d8e"/>
    <path class="thin" d="M170 76 L184 74 L170 82 Z" style="fill:#5b2d8e"/>
    <path class="thin" d="M150 62 H170 L167 84 L160 94 L153 84 Z" style="fill:#5b2d8e"/>`,
  },
  doom: {
    label: 'Dr. Doom',
    color: '#2f6b3a',
    svg: `
    <path d="M116 84 Q160 72 204 84 L206 124 Q206 150 196 166 L176 180 H144 L124 166 Q114 150 114 124 Z" style="fill:#b4bcc4"/>
    <path class="ns" d="M116 126 Q116 150 126 164 L140 176 L134 130 Z" style="fill:rgba(0,0,0,.14)"/>
    <path class="ns" d="M204 126 Q204 150 194 164 L180 176 L186 130 Z" style="fill:rgba(0,0,0,.14)"/>
    <path class="thin" d="M116 98 L160 112 L204 98 L204 108 L160 122 L116 108 Z" style="fill:#8f979f"/>
    <path class="thin" d="M126 116 L152 124 L150 131 L130 127 Z" style="fill:var(--sil)"/>
    <path class="thin" d="M194 116 L168 124 L170 131 L190 127 Z" style="fill:var(--sil)"/>
    <circle class="k ns" cx="141" cy="125" r="2.6"/><circle class="k ns" cx="179" cy="125" r="2.6"/>
    <path class="thin" d="M160 124 L154 148 H166 Z" style="fill:#8f979f"/>
    <path class="o thin" d="M130 134 L138 160 M190 134 L182 160"/>
    <path class="k" d="M138 154 H182 V160 H138 Z"/>
    <path class="o thin" d="M146 163 V174 M154 163 V177 M166 163 V177 M174 163 V174"/>
    <circle class="k ns" cx="122" cy="92" r="3"/><circle class="k ns" cx="198" cy="92" r="3"/>
    <circle class="k ns" cx="120" cy="140" r="3"/><circle class="k ns" cx="200" cy="140" r="3"/>
    <path class="f" style="fill-rule:evenodd" d="M160 40 C178 44 194 52 204 66 C212 78 213 88 210 96 C222 112 228 136 226 160 C234 180 244 196 246 212 C232 220 214 220 200 216 C184 224 136 224 120 216 C106 220 88 220 74 212 C76 196 86 180 94 160 C92 136 98 112 110 96 C107 88 108 78 116 66 C126 52 142 44 160 40 Z M160 86 C184 86 200 100 202 124 C204 150 196 172 182 184 Q160 194 138 184 C124 172 116 150 118 124 C120 100 136 86 160 86 Z"/>
    <path class="o ns" d="M160 86 C184 86 200 100 202 124 C204 150 196 172 182 184 Q160 194 138 184 C124 172 116 150 118 124 C120 100 136 86 160 86 Z" style="stroke:#1e4a27;stroke-width:7px"/>
    <path class="o ns" d="M160 42 V64 M118 70 Q110 84 112 98 M202 70 Q210 84 208 98 M100 168 Q92 190 90 214 M220 168 Q228 190 230 214 M120 192 Q114 206 114 222 M200 192 Q206 206 206 222" style="stroke:#1e4a27;stroke-width:3px"/>
    <path class="ns" d="M118 72 C102 96 96 132 102 162 C108 150 110 120 120 100 Z" style="fill:rgba(255,255,255,.14)"/>
    <path class="ns" d="M202 72 C218 96 224 132 218 162 C212 150 210 120 200 100 Z" style="fill:rgba(0,0,0,.16)"/>
    <path class="o ns" d="M128 130 Q126 150 134 166" style="stroke:rgba(255,255,255,.55);stroke-width:3px"/>`,
  },
  tiara: {
    label: 'Tiara',
    color: '#f2c14e',
    svg: `
      <path class="f" d="M106 90 C106 70 118 58 132 62 C130 48 146 38 160 42 C174 38 190 48 188 62 C202 58 214 70 214 90 Q160 80 106 90 Z"/>
      <path class="o thin" d="M122 72 Q130 62 140 68" style="stroke:var(--c)"/>
      <path class="o thin" d="M198 72 Q190 62 180 68" style="stroke:var(--c)"/>
      <path d="M160 44 C160 36 152 32 148 36 C144 40 150 46 160 54 C170 46 176 40 172 36 C168 32 160 36 160 44 Z" style="fill:#f05a8a"/>
      <path d="M160 28 C160 24 156 22 154 24 C152 26 156 30 160 34 C164 30 168 26 166 24 C164 22 160 24 160 28 Z" style="fill:#f05a8a"/>
      <circle class="w" cx="160" cy="22" r="4"/>
      <circle cx="116" cy="80" r="5" style="fill:#f05a8a"/>
      <circle cx="204" cy="80" r="5" style="fill:#f05a8a"/>
      <circle class="w" cx="124" cy="88" r="3"/>
      <circle class="w" cx="140" cy="90" r="3"/>
      <circle class="w" cx="160" cy="91" r="3"/>
      <circle class="w" cx="180" cy="90" r="3"/>
      <circle class="w" cx="196" cy="88" r="3"/>`,
  },
  rose: {
    label: 'Rosa',
    color: '#e0507a',
    svg: `
      <g class="pom">
        <circle class="f" cx="122" cy="56" r="11"/>
        <circle class="f" cx="109" cy="65" r="11"/>
        <circle class="f" cx="114" cy="80" r="11"/>
        <circle class="f" cx="130" cy="80" r="11"/>
        <circle class="f" cx="135" cy="65" r="11"/>
        <circle cx="122" cy="69" r="8" style="fill:#c23a52"/>
      </g>`,
  },
  hairShort: {
    label: 'Pelo corto',
    color: '#6b4428',
    svg: `
      <path class="f" d="M78 118 C74 80 100 50 160 48 C220 50 246 80 242 118 C244 150 230 180 206 198 C212 178 215 155 215 138 C215 108 196 82 160 78 C124 82 105 108 105 138 C105 155 108 178 114 198 C90 180 76 150 78 118 Z"/>
      <path class="o thin" d="M160 48 V78" style="stroke:var(--ink)"/>`,
    back: `
      <path class="f" d="M56 185 L56 75 A130 150 0 0 1 264 75 L264 185 Z"/>`,
  },
  hairLong: {
    label: 'Pelo largo',
    color: '#6b4428',
    svg: `
      <path class="f" d="M78 118 C74 80 100 50 160 48 C220 50 246 80 242 118 C248 165 225 220 195 255 C208 225 212 180 212 140 C212 108 196 82 160 78 C124 82 108 108 108 140 C108 180 112 225 125 255 C95 220 72 165 78 118 Z"/>
      <path class="o thin" d="M160 48 V78" style="stroke:var(--ink)"/>`,
    back: `
      <path class="f" d="M56 230 L56 75 A130 150 0 0 1 264 75 L264 230 Z"/>`,
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
  eyelashes: {
    label: 'Pestañas',
    color: '#1c1c1c',
    svg: `
      <path class="o thin" d="M118 102 Q126 94 134 98 M124 98 Q132 90 140 96" style="stroke:var(--c)"/>
      <path class="o thin" d="M186 96 Q194 90 202 98 M180 98 Q188 94 196 102" style="stroke:var(--c)"/>`,
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
  strange: {
    label: 'Dr. Strange',
    color: '#b5121b',
    back: `<path class="f" d="M112 190 Q160 178 208 190 C236 214 256 250 266 290 Q236 280 214 292 Q188 280 160 292 Q132 280 106 292 Q84 280 54 290 C64 250 84 214 112 190 Z"/>
    <path class="f" d="M120 200 C80 190 66 140 80 84 C100 110 112 150 150 186 Z"/>
    <path class="f" d="M200 200 C240 190 254 140 240 84 C220 110 208 150 170 186 Z"/>
    <path class="o ns" d="M112 194 C86 180 78 140 84 100 M208 194 C234 180 242 140 236 100" style="stroke:#e8b62c;stroke-width:3px"/>`,
    svg: `
    <circle class="thin" cx="160" cy="210" r="15" style="fill:#e8b62c"/>
    <path class="ns" d="M149 210 Q160 201 171 210 Q160 219 149 210 Z" style="fill:#2fd07a"/>
    <circle class="k ns" cx="160" cy="210" r="3"/>`,
  },
  necklace: {
    label: 'Collar',
    color: '#f2c14e',
    svg: `
      <path class="o" d="M116 196 Q160 246 204 196" style="stroke-width:11px"/>
      <path class="o ns" d="M116 196 Q160 246 204 196" style="stroke:var(--c);stroke-width:5px"/>
      <path class="f" d="M160 222 L172 234 L160 246 L148 234 Z"/>`,
  },
} satisfies Record<string, AvatarPiece>;

export const BODY_PIECES = {
  blouse: {
    label: 'Blusa',
    color: '#3d7be0',
    svg: `
      <path class="f" d="M63 266 Q64 204 123 184 Q160 192 197 184 Q256 204 257 266 Q257 274 249 274 L71 274 Q63 274 63 266 Z"/>`,
  },
  sweetheartTop: {
    label: 'Escote corazón',
    color: '#f08aa0',
    svg: `
      <path class="f" d="M63 266 Q70 248 85 232 Q95 212 122 212 Q140 224 160 250 Q180 224 198 212 Q225 212 235 232 Q250 248 257 266 Q257 274 249 274 L71 274 Q63 274 63 266 Z"/>`,
  },
} satisfies Record<string, AvatarPiece>;

export type HeadId = keyof typeof HEAD_PIECES;
export type FaceId = keyof typeof FACE_PIECES;
export type NeckId = keyof typeof NECK_PIECES;
export type BodyId = keyof typeof BODY_PIECES;

export const PIECES: Record<AvatarSlot, Record<string, AvatarPiece>> = {
  body: BODY_PIECES,
  head: HEAD_PIECES,
  face: FACE_PIECES,
  neck: NECK_PIECES,
};

export const SLOT_LABELS: Record<AvatarSlot, string> = {
  body: 'Ropa',
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
  body?: BodyId[];
  head?: HeadId[];
  face?: FaceId[];
  neck?: NeckId[];
  // Clave "<slot>:<id>": cada pieza seleccionada tiene su propio color (con
  // dos piezas en el mismo slot, p. ej. corona + tiara, cada una se
  // recolorea por separado). Se antepone el slot al id por si algún día dos
  // slots comparten un id de pieza; hoy no pasa (los catálogos HEAD/FACE/
  // NECK/BODY_PIECES no se solapan) pero igual conviene no depender de que
  // los ids sean únicos en todo el catálogo.
  colors?: Partial<Record<string, string>>;
  sticker: boolean;
}

export const EMPTY_AVATAR: Avatar = { sticker: true };

const HEX = /^#[0-9a-f]{6}$/i;

/** Ids seleccionados para un slot, en orden (índice 0 = atrás, último = adelante). */
export function idsOf(avatar: Avatar, slot: AvatarSlot): string[] {
  return avatar[slot] ?? [];
}

/** Piezas seleccionadas para un slot, en el mismo orden que idsOf. */
export function piecesOf(avatar: Avatar, slot: AvatarSlot): AvatarPiece[] {
  return idsOf(avatar, slot)
    .map((id) => PIECES[slot][id])
    .filter((piece): piece is AvatarPiece => Boolean(piece));
}

export function colorKey(slot: AvatarSlot, pieceId: string): string {
  return `${slot}:${pieceId}`;
}

/** Color de una pieza puntual: su override si tiene uno, si no el de base del catálogo. */
export function colorOf(avatar: Avatar, slot: AvatarSlot, pieceId: string): string | undefined {
  const own = avatar.colors?.[colorKey(slot, pieceId)];
  if (own && HEX.test(own)) return own;
  return PIECES[slot][pieceId]?.color;
}

// Lo que llega de otros por socket (o de cuentas viejas guardadas con un solo
// id y un solo color por slot) se limpia igual que en el backend: descarta
// ids que no son del catálogo, preserva el orden de los válidos, convierte un
// string suelto en un array de un elemento, y migra colors[slot] (formato
// viejo) a colors["slot:id"] aplicándolo a la única pieza que ese slot tenía.
export function toAvatar(input: unknown): Avatar | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const avatar: Avatar = { sticker: raw.sticker !== false };
  const rawColors = (raw.colors ?? {}) as Record<string, unknown>;
  const colors: Partial<Record<string, string>> = {};
  for (const slot of AVATAR_SLOTS) {
    const rawValue = raw[slot];
    const candidates = Array.isArray(rawValue)
      ? rawValue
      : rawValue !== undefined
        ? [rawValue]
        : [];
    const ids = candidates.filter(
      (id): id is string => typeof id === 'string' && id in PIECES[slot],
    );
    if (ids.length > 0) (avatar as unknown as Record<string, string[]>)[slot] = ids;

    for (const id of ids) {
      const key = colorKey(slot, id);
      const color = rawColors[key];
      if (typeof color === 'string' && HEX.test(color)) colors[key] = color.toLowerCase();
    }
    // Compat con avatares viejos guardados con un solo color por slot.
    if (ids.length === 1 && colors[colorKey(slot, ids[0])] === undefined) {
      const legacy = rawColors[slot];
      if (typeof legacy === 'string' && HEX.test(legacy)) {
        colors[colorKey(slot, ids[0])] = legacy.toLowerCase();
      }
    }
  }
  if (Object.keys(colors).length > 0) avatar.colors = colors;
  return avatar;
}

/** Reemplaza todo el slot por una sola pieza (o lo vacía si id es undefined). */
export function withPiece(avatar: Avatar, slot: AvatarSlot, id: string | undefined): Avatar {
  const next: Avatar = { ...avatar, colors: { ...avatar.colors } };
  for (const prevId of idsOf(avatar, slot)) delete next.colors![colorKey(slot, prevId)];
  if (id) (next as unknown as Record<string, string[]>)[slot] = [id];
  else delete next[slot];
  if (Object.keys(next.colors!).length === 0) delete next.colors;
  return next;
}

/** Suma o quita una pieza del slot sin tocar las demás ya seleccionadas. */
export function togglePiece(avatar: Avatar, slot: AvatarSlot, id: string): Avatar {
  const current = idsOf(avatar, slot);
  const removing = current.includes(id);
  const nextIds = removing ? current.filter((x) => x !== id) : [...current, id];
  const next: Avatar = { ...avatar, colors: { ...avatar.colors } };
  // Al sacar una pieza se limpia solo su propio color; las demás piezas del
  // slot no se tocan.
  if (removing) delete next.colors![colorKey(slot, id)];
  if (nextIds.length > 0) (next as unknown as Record<string, string[]>)[slot] = nextIds;
  else delete next[slot];
  if (Object.keys(next.colors!).length === 0) delete next.colors;
  return next;
}

export function withColor(avatar: Avatar, slot: AvatarSlot, pieceId: string, color: string): Avatar {
  return { ...avatar, colors: { ...avatar.colors, [colorKey(slot, pieceId)]: color.toLowerCase() } };
}

export function randomAvatar(sticker: boolean, random: () => number = Math.random): Avatar {
  const pick = (ids: string[]) => ids[Math.floor(random() * ids.length)];
  return {
    body: [pick(Object.keys(BODY_PIECES)) as BodyId],
    head: [pick(Object.keys(HEAD_PIECES)) as HeadId],
    face: [pick(Object.keys(FACE_PIECES)) as FaceId],
    neck: random() < 0.5 ? undefined : [pick(Object.keys(NECK_PIECES)) as NeckId],
    sticker,
  };
}
