import { describe, expect, it } from '@jest/globals';
import { createBurstPlan } from './burstEffects';

const EMOJIS = ['💖', '👍', '🎉', '👏', '😂', '😮'] as const;

describe('createBurstPlan', () => {
  it('genera keyframes con números finitos en todas las partículas', () => {
    for (let run = 0; run < 50; run++) {
      const plan = createBurstPlan([...EMOJIS]);
      for (const particle of plan.particles) {
        expect(particle.keyframes.length).toBeGreaterThanOrEqual(2);
        for (const frame of particle.keyframes) {
          expect(JSON.stringify(frame)).not.toMatch(/NaN|Infinity/);
        }
      }
    }
  });

  it('usa solo los emojis que formaron la explosión', () => {
    const plan = createBurstPlan(['🎉', '😂']);
    const emojis = plan.particles.filter((p) => p.kind === 'emoji').map((p) => p.emoji);
    expect(new Set(emojis)).toEqual(new Set(['🎉', '😂']));
  });

  it('no repite el mismo plan entre dos explosiones', () => {
    const a = JSON.stringify(createBurstPlan([...EMOJIS]));
    const b = JSON.stringify(createBurstPlan([...EMOJIS]));
    expect(a).not.toBe(b);
  });
});
