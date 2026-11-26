import { describe, expect, it } from '@jest/globals';
import { createSpeechGate, rmsOf } from './mutedSpeech';

describe('mutedSpeech', () => {
  it('el silencio mide cero y la señal máxima mide uno', () => {
    expect(rmsOf(new Uint8Array([128, 128, 128]))).toBe(0);
    expect(rmsOf(new Uint8Array([0, 0]))).toBe(1);
  });

  it('un golpe suelto no avisa', () => {
    const speaking = createSpeechGate();
    expect([0.4, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01].map(speaking).some(Boolean)).toBe(false);
  });

  it('avisa con habla sostenida aunque tenga pausas entre sílabas', () => {
    const speaking = createSpeechGate();
    const results = [0.029, 0.034, 0.01, 0.018, 0.053, 0.015, 0.009, 0.045].map(speaking);
    expect(results.at(-1)).toBe(true);
  });
});

describe('createSpeechGate (umbral por defecto)', () => {
  it('el ruido de fondo filtrado no avisa', () => {
    const noise = createSpeechGate();
    expect(
      [0.008, 0.009, 0.007, 0.01, 0.009, 0.008, 0.009, 0.007, 0.01].map(noise).some(Boolean),
    ).toBe(false);
  });
});
