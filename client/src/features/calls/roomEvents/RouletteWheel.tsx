'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import type { RouletteEventState } from './useRoomEvents';
import styles from './RouletteWheel.module.css';

// Colores solo decorativos (no codifican datos, a diferencia de una paleta
// categórica de un gráfico): alcanza con que se distingan entre sí a simple
// vista en la rueda, no necesitan pasar el validador de contraste del skill
// de dataviz.
const PALETTE = [
  '#9d00ff',
  '#ff6b6b',
  '#ffa94d',
  '#ffd43b',
  '#51cf66',
  '#22b8cf',
  '#5c7cfa',
  '#f06595',
];

const SPIN_MS = 4500;
const BANNER_MS = 2500;
const FULL_SPINS = 6;

function buildGradient(count: number): string {
  const segment = 360 / count;
  const stops = Array.from(
    { length: count },
    (_, i) => `${PALETTE[i % PALETTE.length]} ${i * segment}deg ${(i + 1) * segment}deg`,
  );
  return `conic-gradient(${stops.join(', ')})`;
}

interface RouletteWheelProps {
  state: RouletteEventState;
  onDone(): void;
}

// Se monta con key={state.startedAt} desde RoomPage: cada girada nueva es un
// componente fresco, así el ángulo arranca siempre en 0deg y la transición
// CSS de abajo se dispara de cero en vez de interpolar desde donde haya
// quedado la girada anterior.
export function RouletteWheel({ state, onDone }: RouletteWheelProps) {
  const { t } = useTranslation();
  const { participants, winner } = state;
  const segment = 360 / participants.length;
  const winnerIndex = Math.max(
    0,
    participants.findIndex((p) => p.participantId === winner.participantId),
  );

  // Lazy init de useState (no useMemo): Math.random() es impuro, así que
  // necesita correr exactamente una vez para la vida de este componente, no
  // "memoizado hasta que cambien las deps" (que no garantiza una sola
  // llamada) ni recalculado en cada render.
  const [targetRotation] = useState(() => {
    const winnerCenter = winnerIndex * segment + segment / 2;
    // Un poco de jitter dentro del gajo para que no caiga siempre clavado en
    // el centro exacto; margen chico para no acercarse al borde del gajo.
    const jitter = (Math.random() - 0.5) * segment * 0.6;
    return FULL_SPINS * 360 - winnerCenter + jitter;
  });

  const [rotation, setRotation] = useState(0);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    // Arranca en 0deg (ver comentario de la key arriba) y recién en el
    // siguiente frame pide el ángulo final: si se seteara en el mismo
    // render, el navegador puede pintar directo en la posición final sin
    // animar la transición.
    const frame = requestAnimationFrame(() => setRotation(targetRotation));
    return () => cancelAnimationFrame(frame);
  }, [targetRotation]);

  useEffect(() => {
    const landTimer = setTimeout(() => setLanded(true), SPIN_MS);
    const doneTimer = setTimeout(onDone, SPIN_MS + BANNER_MS);
    return () => {
      clearTimeout(landTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  const gradient = useMemo(() => buildGradient(participants.length), [participants.length]);

  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={styles.card}>
        <p className={styles.heading}>
          {landed ? `🎉 ${winner.userName} ${t('ganó la ruleta')}` : `🎡 ${t('Ruleta')}…`}
        </p>
        <div className={styles.wheelFrame}>
          <div className={styles.pointer} aria-hidden="true" />
          <div
            className={styles.wheel}
            style={{ background: gradient, transform: `rotate(${rotation}deg)` }}
          >
            {participants.map((p, i) => (
              <span
                key={p.participantId}
                className={styles.label}
                style={{ transform: `rotate(${i * segment + segment / 2}deg) translateX(calc(var(--wheel-size) / 8))` }}
              >
                {p.userName}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
