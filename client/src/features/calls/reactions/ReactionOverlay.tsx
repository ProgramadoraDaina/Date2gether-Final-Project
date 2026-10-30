'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import type { BurstParticle } from './burstEffects';
import { useReactions } from './useReactions';
import styles from './Reactions.module.css';

// Corrimiento horizontal estable por reacción, para que no suban todas en la misma línea.
function driftFor(id: string): number {
  return parseInt(id.slice(0, 2), 16) % 64;
}

function Particle({ particle }: { particle: BurstParticle }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animation = reduced
      ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1200, fill: 'forwards' })
      : el.animate(particle.keyframes, particle.options);
    return () => animation.cancel();
  }, [particle]);

  const className =
    particle.kind === 'emoji'
      ? styles.particle
      : particle.kind === 'ring'
        ? styles.burstRing
        : styles.burstLine;

  return (
    <span ref={ref} className={className} style={{ fontSize: particle.size } as CSSProperties}>
      {particle.emoji}
    </span>
  );
}

export function ReactionOverlay() {
  const { reactions, bursts } = useReactions();

  return (
    <div className={styles.overlay} aria-hidden="true">
      <div className={styles.floatColumn}>
        {reactions
          .filter((r) => !r.exploded)
          .map((r) => (
            <div
              key={r.id}
              className={styles.floating}
              style={{ '--drift': `${driftFor(r.id)}px` } as CSSProperties}
            >
              <span className={styles.floatingEmoji}>{r.emoji}</span>
              {r.name && <span className={styles.floatingName}>{r.name}</span>}
            </div>
          ))}
      </div>
      {bursts.map((burst) => (
        <div
          key={burst.id}
          className={styles.burst}
          style={{
            left: burst.plan.origin.left,
            bottom: `${burst.plan.origin.bottomPercent}%`,
          }}
        >
          {burst.plan.particles.map((particle, i) => (
            <Particle key={i} particle={particle} />
          ))}
        </div>
      ))}
    </div>
  );
}
