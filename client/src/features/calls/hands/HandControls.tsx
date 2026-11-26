'use client';

import { useTranslation } from '../../translation/useTranslation';
import { useParticipantColor } from '../participantColors';
import { useHands } from './HandsProvider';
import type { RaisedHand } from './hands';
import styles from './Hands.module.css';

export function HandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
      <path d="M14 10V4a2 2 0 0 0-4 0v6" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}

export function HandButton({
  buttonClassName,
  activeClassName,
}: {
  buttonClassName: string;
  activeClassName: string;
}) {
  const { t } = useTranslation();
  const { raised, toggle } = useHands();
  const label = t(raised ? 'Bajar la mano' : 'Levantar la mano');
  return (
    <button
      type="button"
      className={`${buttonClassName} ${raised ? activeClassName : ''}`}
      onClick={toggle}
      aria-pressed={raised}
      title={`${label} (Ctrl+Alt+H)`}
      aria-label={label}
    >
      <HandIcon />
    </button>
  );
}

// Insignia del mosaico con el número de turno de esa persona.
export function HandBadge({ identity }: { identity: string }) {
  const { t } = useTranslation();
  const { queue } = useHands();
  const turn = queue.findIndex((hand) => hand.identity === identity);
  if (turn < 0) return null;
  return (
    <span className={styles.badge} title={t('Mano levantada')}>
      <HandIcon />
      <span className={styles.turn}>{turn + 1}</span>
    </span>
  );
}

function QueueRow({ hand, turn, canLower }: { hand: RaisedHand; turn: number; canLower: boolean }) {
  const { t } = useTranslation();
  const { lower } = useHands();
  const color = useParticipantColor(hand.identity);
  return (
    <li className={styles.row}>
      <span className={styles.turn}>{turn}</span>
      <span className={styles.swatch} style={{ background: color }} aria-hidden="true" />
      <span className={styles.name}>{hand.name}</span>
      {canLower && (
        <button
          type="button"
          className={styles.lower}
          onClick={() => lower(hand.identity)}
          aria-label={`${t('Bajar la mano de')} ${hand.name}`}
          title={t('Bajar la mano')}
        >
          ×
        </button>
      )}
    </li>
  );
}

export function HandQueue({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const { queue, own } = useHands();
  if (queue.length === 0) return null;
  return (
    <section className={styles.queue} aria-label={t('Manos levantadas')}>
      <h2 className={styles.title}>
        {t('Manos levantadas')} <span className={styles.count}>{queue.length}</span>
      </h2>
      <ol className={styles.list}>
        {queue.map((hand, index) => (
          <QueueRow
            key={hand.identity}
            hand={hand}
            turn={index + 1}
            canLower={isAdmin || hand.identity === own}
          />
        ))}
      </ol>
    </section>
  );
}
