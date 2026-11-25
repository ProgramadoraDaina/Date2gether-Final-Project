// Nivel RMS (0..1) de una muestra de getByteTimeDomainData.
export function rmsOf(samples: Uint8Array): number {
  let sum = 0;
  for (const value of samples) sum += ((value - 128) / 128) ** 2;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

// Habla sostenida: promedio y cantidad de lecturas altas en una ventana; tolera pausas entre sílabas pero no un golpe suelto.
// Con el mic apagado en LiveKit una voz normal promedia ~0.03; el ruido filtrado queda debajo de 0.01.
export function createSpeechGate(threshold = 0.02, frames = 3, window = 8) {
  const recent: number[] = [];
  return (level: number): boolean => {
    recent.push(level);
    if (recent.length > window) recent.shift();
    if (recent.length < window) return false;
    const average = recent.reduce((sum, value) => sum + value, 0) / window;
    return average >= threshold && recent.filter((value) => value >= threshold).length >= frames;
  };
}
