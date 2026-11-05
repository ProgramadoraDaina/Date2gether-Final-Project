'use client';

import { ParticipantTile, useMaybeTrackRefContext } from '@livekit/components-react';
import type { CSSProperties } from 'react';
import { customReactionKey } from './reactions';
import { ReactionGlyph } from './ReactionGlyph';
import { useReactions } from './useReactions';
import styles from './Reactions.module.css';

// GridLayout clona este componente por cada participante y le da su TrackRef por contexto.
export function ReactionTile() {
  const trackRef = useMaybeTrackRefContext();
  const { reactions, stickers } = useReactions();
  const identity = trackRef?.participant.identity;
  const latest = identity ? reactions.findLast((r) => r.identity === identity) : undefined;
  const sticker = identity ? stickers[identity] : undefined;

  return (
    <div className={styles.tileWrap}>
      <ParticipantTile />
      {latest && (
        <span key={latest.id} className={styles.tileBadge} aria-hidden="true">
          <ReactionGlyph reactionKey={latest.key} />
        </span>
      )}
      {sticker && (
        <span
          key={sticker.id}
          className={styles.sticker}
          data-position={sticker.options.position}
          data-size={sticker.options.size}
          aria-hidden="true"
          style={{ '--sticker-duration': `${sticker.options.duration}s` } as CSSProperties}
        >
          <span className={styles.stickerGlyph} data-animation={sticker.options.animation}>
            <ReactionGlyph reactionKey={customReactionKey(sticker.roomEmojiId)} />
          </span>
        </span>
      )}
    </div>
  );
}
