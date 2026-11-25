import { describe, expect, it } from '@jest/globals';
import { createSpeechGate, rmsOf } from './mutedSpeech';

describe('mutedSpeech', () => {
  it('el silencio mide cero y la señal máxima mide uno', () => {
    expect(rmsOf(new Uint8Array([128, 128, 128]))).toBe(0);
    expect(rmsOf(new Uint8Array([0, 0]))).toBe(1);
  });

  it('solo avisa con habla sostenida, no con un pico suelto', () => {
    const speaking = createSpeechGate(0.05, 3);
    expect(speaking(0.2)).toBe(false);
    expect(speaking(0.01)).toBe(false);
    expect(speaking(0.2)).toBe(false);
    expect(speaking(0.2)).toBe(false);
    expect(speaking(0.2)).toBe(true);
  });
});
