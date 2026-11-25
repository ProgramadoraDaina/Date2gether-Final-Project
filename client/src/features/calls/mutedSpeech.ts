// Nivel RMS (0..1) de una muestra de getByteTimeDomainData.
export function rmsOf(samples: Uint8Array): number {
  let sum = 0;
  for (const value of samples) sum += ((value - 128) / 128) ** 2;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

// Habla sostenida: varias lecturas seguidas sobre el umbral, para no saltar con un golpe o una tos.
export function createSpeechGate(threshold = 0.05, frames = 5) {
  let streak = 0;
  return (level: number): boolean => {
    streak = level >= threshold ? streak + 1 : 0;
    return streak >= frames;
  };
}
