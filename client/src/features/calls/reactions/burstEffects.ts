import type { ReactionEmoji } from './reactions';

export interface BurstParticle {
  kind: 'emoji' | 'ring' | 'line';
  emoji?: ReactionEmoji;
  size: number;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

export interface BurstPlan {
  origin: { left: number; bottomPercent: number };
  particles: BurstParticle[];
}

type Effect = (r: Rng) => Keyframe[];

interface Rng {
  between: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  chance: (p: number) => boolean;
}

const rng: Rng = {
  between: (min, max) => min + Math.random() * (max - min),
  pick: (items) => items[Math.floor(Math.random() * items.length)],
  chance: (p) => Math.random() < p,
};

const EASINGS = [
  'linear',
  'cubic-bezier(0.1, 0.8, 0.3, 1)',
  'cubic-bezier(0.7, 0, 0.9, 0.4)',
  'cubic-bezier(0.3, 0.1, 0.1, 1)',
  'steps(6, end)',
] as const;

function tf(x: number, y: number, rotate = 0, sx = 1, sy = sx): string {
  return `translate(${x}px, ${y}px) rotate(${rotate}deg) scale(${sx}, ${sy})`;
}

function direction(r: Rng): [number, number] {
  const angle = r.between(0, Math.PI * 2);
  return [Math.cos(angle), Math.sin(angle)];
}

const shatter: Effect = (r) => {
  const [dx, dy] = direction(r);
  const dist = r.between(80, 240);
  const spin = r.between(-900, 900);
  const fall = r.between(40, 200);
  return [
    { transform: tf(0, 0), opacity: 1 },
    { transform: tf(dx * dist, dy * dist, spin / 2, r.between(0.8, 1.6)), offset: 0.55 },
    { transform: tf(dx * dist * 1.2, dy * dist + fall, spin, r.between(0.2, 0.8)), opacity: 0 },
  ];
};

const fountain: Effect = (r) => {
  const dx = r.between(-160, 160);
  const peak = -r.between(120, 300);
  return [
    { transform: tf(0, 0), opacity: 1 },
    { transform: tf(dx * 0.5, peak, r.between(-90, 90), 1.3), offset: r.between(0.35, 0.55) },
    { transform: tf(dx, r.between(60, 220), r.between(-360, 360), 0.6), opacity: 0 },
  ];
};

const spiral: Effect = (r) => {
  const steps = 9;
  const turn = r.pick([-1, 1]) * r.between(0.6, 1.4);
  const start = r.between(0, Math.PI * 2);
  const maxRadius = r.between(90, 200);
  return Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1);
    const angle = start + turn * Math.PI * 2 * t;
    const radius = maxRadius * t;
    return {
      transform: tf(Math.cos(angle) * radius, Math.sin(angle) * radius, 360 * turn * t, 1 + t * 0.6),
      opacity: t > 0.75 ? 1 - (t - 0.75) * 4 : 1,
    };
  });
};

const glitch: Effect = (r) => {
  const jumps = Math.round(r.between(4, 8));
  return [
    { transform: tf(0, 0), opacity: 1, easing: 'steps(1, end)' },
    ...Array.from({ length: jumps }, () => ({
      transform: tf(r.between(-200, 200), r.between(-180, 120), r.pick([0, 90, -90, 180]), r.between(0.6, 2)),
      opacity: r.pick([1, 0.2, 1, 0.6]),
      easing: 'steps(1, end)',
    })),
    { transform: tf(r.between(-220, 220), r.between(-200, 140)), opacity: 0 },
  ];
};

const implode: Effect = (r) => {
  const [dx, dy] = direction(r);
  const dist = r.between(180, 340);
  return [
    { transform: tf(0, 0), opacity: 1 },
    { transform: tf(dx * -12, dy * -12, 0, 0.15), offset: r.between(0.2, 0.4) },
    { transform: tf(dx * dist, dy * dist, r.between(-540, 540), r.between(1.6, 2.8)), opacity: 0 },
  ];
};

const zigzag: Effect = (r) => {
  const points = Math.round(r.between(3, 6));
  const [dx, dy] = direction(r);
  let x = 0;
  let y = 0;
  const frames: Keyframe[] = [{ transform: tf(0, 0), opacity: 1 }];
  for (let i = 0; i < points; i++) {
    x += dx * r.between(20, 70) + r.between(-60, 60);
    y += dy * r.between(20, 70) + r.between(-60, 60);
    frames.push({ transform: tf(x, y, r.between(-45, 45)) });
  }
  frames.push({ transform: tf(x * 1.3, y * 1.3, 0, 0.4), opacity: 0 });
  return frames;
};

const stretch: Effect = (r) => {
  const [dx, dy] = direction(r);
  const dist = r.between(100, 260);
  const along = r.chance(0.5);
  return [
    { transform: tf(0, 0), opacity: 1 },
    {
      transform: tf(dx * dist * 0.4, dy * dist * 0.4, 0, along ? 2.6 : 0.3, along ? 0.3 : 2.6),
      offset: 0.4,
    },
    { transform: tf(dx * dist, dy * dist, 0, along ? 0.4 : 1.8, along ? 1.8 : 0.4), opacity: 0 },
  ];
};

const orbit: Effect = (r) => {
  const radius = r.between(50, 120);
  const start = r.between(0, Math.PI * 2);
  const dir = r.pick([-1, 1]);
  const frames: Keyframe[] = Array.from({ length: 7 }, (_, i) => {
    const angle = start + dir * (i / 6) * Math.PI * 2;
    return { transform: tf(Math.cos(angle) * radius, Math.sin(angle) * radius, dir * i * 60) };
  });
  frames[0].opacity = 1;
  frames.push({ transform: tf(r.between(-40, 40), r.between(220, 360), dir * 540, 0.5), opacity: 0 });
  return frames;
};

const EFFECTS = [shatter, fountain, spiral, glitch, implode, zigzag, stretch, orbit] as const;

function emojiParticle(emoji: ReactionEmoji, effect: Effect, delay: number, r: Rng): BurstParticle {
  const shard = r.chance(0.35);
  const ox = r.between(-24, 24);
  const oy = r.between(-24, 24);
  const keyframes = effect(r).map((frame) => ({
    ...frame,
    transform: `translate(${ox}px, ${oy}px) ${String(frame.transform)}`,
  }));
  return {
    kind: 'emoji',
    emoji,
    size: shard ? r.between(12, 20) : r.between(26, 44),
    keyframes,
    options: {
      duration: r.between(700, 1700),
      delay,
      easing: r.pick(EASINGS),
      fill: 'forwards',
    },
  };
}

function decorations(r: Rng): BurstParticle[] {
  const style = r.pick(['none', 'ring', 'rings', 'cross', 'sweep'] as const);
  // Crece en tamaño y no con scale(): así el borde se mantiene en 1px.
  const ring = (delay: number): BurstParticle => {
    const width = r.between(160, 360);
    const height = r.between(100, 360);
    return {
      kind: 'ring',
      size: 16,
      keyframes: [
        { width: '16px', height: '16px', margin: '-8px 0 0 -8px', opacity: 1 },
        {
          width: `${width}px`,
          height: `${height}px`,
          margin: `${-height / 2}px 0 0 ${-width / 2}px`,
          opacity: 0,
        },
      ],
      options: { duration: r.between(400, 900), delay, easing: 'linear', fill: 'forwards' },
    };
  };
  const line = (rotate: number, delay: number): BurstParticle => ({
    kind: 'line',
    size: 1,
    keyframes: [
      { transform: `rotate(${rotate}deg) scaleX(0)`, opacity: 1 },
      { transform: `rotate(${rotate}deg) scaleX(${r.between(120, 320)})`, opacity: 0 },
    ],
    options: { duration: r.between(250, 600), delay, easing: 'linear', fill: 'forwards' },
  });

  switch (style) {
    case 'ring':
      return [ring(0)];
    case 'rings':
      return Array.from({ length: Math.round(r.between(2, 4)) }, (_, i) => ring(i * r.between(80, 200)));
    case 'cross': {
      const base = r.between(0, 90);
      return Array.from({ length: Math.round(r.between(2, 5)) }, (_, i) =>
        line(base + i * r.between(20, 70), r.between(0, 120)),
      );
    }
    case 'sweep':
      return [line(r.between(-20, 20), 0), line(r.between(160, 200), r.between(60, 160))];
    default:
      return [];
  }
}

export function createBurstPlan(emojis: ReactionEmoji[], r: Rng = rng): BurstPlan {
  const count = Math.round(r.between(8, 22));
  const mode = r.pick(['unison', 'chaos', 'waves'] as const);
  const unisonEffect = r.pick(EFFECTS);
  const waveEffects = Array.from({ length: Math.round(r.between(2, 3)) }, () => r.pick(EFFECTS));

  const particles = Array.from({ length: count }, (_, i) => {
    const emoji = emojis[i % emojis.length];
    if (mode === 'unison') return emojiParticle(emoji, unisonEffect, r.between(0, 120), r);
    if (mode === 'chaos') return emojiParticle(emoji, r.pick(EFFECTS), r.between(0, 300), r);
    const wave = i % waveEffects.length;
    return emojiParticle(emoji, waveEffects[wave], wave * r.between(150, 350), r);
  });

  return {
    origin: { left: r.between(20, 140), bottomPercent: r.between(25, 65) },
    particles: [...decorations(r), ...particles],
  };
}
