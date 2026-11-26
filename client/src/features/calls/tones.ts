// Notas cortas generadas en el navegador: no hace falta descargar archivos de audio.
export const SPEAKER_TEST = [523.25, 659.25, 783.99];
export const JOIN_TONE = [659.25, 987.77];
export const LEAVE_TONE = [987.77, 659.25];

const NOTE_SECONDS = 0.16;

export function tonesDuration(notes: number[]): number {
  return Math.round(notes.length * NOTE_SECONDS * 1000);
}

export function playTones(notes: number[], volume = 0.12): Promise<void> {
  if (typeof AudioContext === 'undefined') return Promise.resolve();
  const context = new AudioContext();
  const start = context.currentTime + 0.02;
  notes.forEach((frequency, index) => {
    const at = start + index * NOTE_SECONDS;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_SECONDS);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + NOTE_SECONDS);
  });
  return new Promise((resolve) =>
    setTimeout(
      () => {
        void context.close().catch(() => undefined);
        resolve();
      },
      tonesDuration(notes) + 80,
    ),
  );
}
