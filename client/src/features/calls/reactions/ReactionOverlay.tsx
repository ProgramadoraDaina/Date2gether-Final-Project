'use client';

import type { CSSProperties } from 'react';
import { useReactions } from './useReactions';
import styles from './Reactions.module.css';

const BURST_RADIUS_PX = 140;

// Corrimiento horizontal estable por reacción, para que no suban todas en la misma línea.
function driftFor(id: string): number {
  return parseInt(id.slice(0, 2), 16) % 64;
}

export function ReactionOverlay() {
  const { reactions, bursts } = useReactions();

  return (
    <div className={styles.overlay} aria-hidden="true">
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
      {bursts.map((burst) => (
        <div key={burst.id} className={styles.burst}>
          {burst.emojis.map((emoji, i) => {
            const angle = (i / burst.emojis.length) * 2 * Math.PI;
            return (
              <span
                key={i}
                className={styles.particle}
                style={
                  {
                    '--dx': `${Math.cos(angle) * BURST_RADIUS_PX}px`,
                    '--dy': `${Math.sin(angle) * BURST_RADIUS_PX}px`,
                  } as CSSProperties
                }
              >
                {emoji}
              </span>
            );
          })}
          <span className={styles.burstRing} />
        </div>
      ))}
    </div>
  );
}
