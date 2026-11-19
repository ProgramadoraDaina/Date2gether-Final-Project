'use client';

import {
  ParticipantTile,
  useMaybeLayoutContext,
  useMaybeTrackRefContext,
  usePinnedTracks,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { TileAvatar } from '@/features/avatar/TileAvatar';
import { useTranslation } from '../../translation/useTranslation';
import { customReactionKey } from './reactions';
import { ReactionGlyph } from './ReactionGlyph';
import { FocusIcon } from './FocusIcon';
import { useReactions } from './useReactions';
import styles from './Reactions.module.css';

// GridLayout/CarouselLayout clonan este componente por cada participante y
// le dan su TrackRef por contexto (ver MeetingRoom.tsx: el tile en foco usa
// el mismo mecanismo, pero con un TrackRefContext.Provider propio en vez de
// uno de la grilla).
export function ReactionTile({ canFocus = true }: { canFocus?: boolean }) {
  const { t } = useTranslation();
  const trackRef = useMaybeTrackRefContext();
  const layoutContext = useMaybeLayoutContext();
  const pinnedTracks = usePinnedTracks(layoutContext);
  const { reactions, stickers } = useReactions();
  const identity = trackRef?.participant.identity;
  const latest = identity ? reactions.findLast((r) => r.identity === identity) : undefined;
  const sticker = identity ? stickers[identity] : undefined;
  const focused = pinnedTracks[0];
  const isFocused = !!(
    trackRef &&
    focused &&
    focused.participant.identity === trackRef.participant.identity &&
    focused.source === trackRef.source
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const [placeholder, setPlaceholder] = useState<Element | null>(null);
  const isCamera = trackRef?.source === Track.Source.Camera;
  useEffect(() => {
    setPlaceholder(wrapRef.current?.querySelector('.lk-participant-placeholder') ?? null);
  }, [isCamera, identity]);

  function toggleFocus() {
    if (!trackRef || !layoutContext?.pin.dispatch) return;
    layoutContext.pin.dispatch(
      isFocused ? { msg: 'clear_pin' } : { msg: 'set_pin', trackReference: trackRef },
    );
  }

  return (
    <div className={styles.tileWrap} ref={wrapRef}>
      <ParticipantTile />
      {trackRef && isCamera && placeholder && (
        <TileAvatar participant={trackRef.participant} placeholder={placeholder} />
      )}
      {trackRef && (canFocus || isFocused) && (
        <button
          type="button"
          className={`${styles.focusToggle} ${isFocused ? styles.focusToggleActive : ''}`}
          onClick={toggleFocus}
          title={t(isFocused ? 'Quitar de foco' : 'Poner en foco')}
          aria-label={t(isFocused ? 'Quitar de foco' : 'Poner en foco')}
          aria-pressed={isFocused}
        >
          <FocusIcon />
        </button>
      )}
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
