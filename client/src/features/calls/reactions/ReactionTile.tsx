'use client';

import { ParticipantTile, useMaybeTrackRefContext } from '@livekit/components-react';
import { useReactions } from './useReactions';
import styles from './Reactions.module.css';

// GridLayout clona este componente por cada participante y le da su TrackRef por contexto.
export function ReactionTile() {
  const trackRef = useMaybeTrackRefContext();
  const { reactions } = useReactions();
  const identity = trackRef?.participant.identity;
  const latest = identity ? reactions.findLast((r) => r.identity === identity) : undefined;

  return (
    <div className={styles.tileWrap}>
      <ParticipantTile />
      {latest && (
        <span key={latest.id} className={styles.tileBadge} aria-hidden="true">
          {latest.emoji}
        </span>
      )}
    </div>
  );
}
