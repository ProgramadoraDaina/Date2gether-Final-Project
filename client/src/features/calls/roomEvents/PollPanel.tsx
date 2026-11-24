'use client';

import { useTranslation } from '@/features/translation/useTranslation';
import type { PollEventState } from './useRoomEvents';
import styles from './PollPanel.module.css';

interface PollPanelProps {
  state: PollEventState;
  currentParticipantId: string;
  canManage: boolean;
  onVote(optionIndexes: number[]): void;
  // Cierre manual del panel (como EventTicker.onClose), distinto de cerrar
  // la encuesta en sí (onClosePoll): uno oculta el panel para quien mira,
  // el otro la cierra para toda la sala.
  onClose(): void;
  onClosePoll?(): void;
}

export function PollPanel({
  state,
  currentParticipantId,
  canManage,
  onVote,
  onClose,
  onClosePoll,
}: PollPanelProps) {
  const { t } = useTranslation();
  const { question, options, multipleChoice, anonymous, participants, votes, closed } = state;

  const myVotes = votes[currentParticipantId] ?? [];
  const isParticipant = participants.some((p) => p.participantId === currentParticipantId);
  const canVote = !closed && isParticipant;
  const voteCounts = options.map(
    (_, index) => Object.values(votes).filter((picked) => picked.includes(index)).length,
  );
  const votedCount = Object.keys(votes).length;
  const allVoted = participants.length > 0 && votedCount === participants.length;

  // Porcentaje sobre la gente que ya votó (no sobre el total de la sala): así
  // cada opción se lee como "de los que respondieron, cuántos la eligieron",
  // y tiene sentido incluso en encuestas multipleChoice donde la suma puede
  // superar el 100%.
  function percentFor(count: number): number {
    return votedCount === 0 ? 0 : Math.round((count / votedCount) * 100);
  }

  function handlePick(index: number) {
    if (!canVote) return;
    if (multipleChoice) {
      const next = myVotes.includes(index)
        ? myVotes.filter((i) => i !== index)
        : [...myVotes, index];
      onVote(next);
    } else {
      onVote(myVotes.includes(index) ? [] : [index]);
    }
  }

  function votersFor(index: number): string {
    return participants
      .filter((p) => votes[p.participantId]?.includes(index))
      .map((p) => p.userName)
      .join(', ');
  }

  return (
    <div className={styles.panel} role="status">
      <div className={styles.header}>
        <span className={styles.badge}>📊 {t('Encuesta')}</span>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t('Cerrar')}>
          ✕
        </button>
      </div>
      <p className={styles.question}>{question}</p>
      <ul className={styles.options}>
        {options.map((option, index) => {
          const count = voteCounts[index];
          const percent = percentFor(count);
          const picked = myVotes.includes(index);
          return (
            <li key={index} className={styles.optionRow}>
              <button
                type="button"
                className={styles.optionButton}
                data-picked={picked}
                onClick={() => handlePick(index)}
                disabled={!canVote}
                role={multipleChoice ? 'checkbox' : 'radio'}
                aria-checked={picked}
              >
                <span className={styles.optionLabel}>{option}</span>
                <span className={styles.optionCount}>{percent}%</span>
              </button>
              <div className={styles.barTrack}>
                <div className={styles.barFill} style={{ width: `${percent}%` }} />
              </div>
              {!anonymous && count > 0 && (
                <p className={styles.voters}>{votersFor(index)}</p>
              )}
            </li>
          );
        })}
      </ul>
      <div className={styles.footer}>
        <span className={styles.tally} data-complete={allVoted}>
          {allVoted ? '✓ ' : ''}
          {votedCount}/{participants.length} {t('votaron')}
        </span>
        {closed && <span className={styles.closedBadge}>{t('Encuesta cerrada')}</span>}
        {canManage && !closed && (
          <button type="button" className={styles.closePollButton} onClick={onClosePoll}>
            {t('Cerrar encuesta')}
          </button>
        )}
      </div>
    </div>
  );
}
