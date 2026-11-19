import { useId, type CSSProperties } from 'react';
import { EMPTY_AVATAR, colorOf, idsOf, piecesOf, type Avatar, type AvatarSlot } from './catalog';
import styles from './AvatarFigure.module.css';

const DRAW_ORDER: AvatarSlot[] = ['body', 'neck', 'face', 'head'];

interface AvatarFigureProps {
  avatar: Avatar | null | undefined;
  speaking?: boolean;
  animated?: boolean;
  label?: string;
  className?: string;
}

export function AvatarFigure({
  avatar,
  speaking = false,
  animated = true,
  label,
  className,
}: AvatarFigureProps) {
  // useId trae caracteres que rompen url(#id) dentro del atributo mask.
  const maskId = `neck-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const clipId = `${maskId}-head`;
  const look = avatar ?? EMPTY_AVATAR;

  function layer(slot: AvatarSlot, which: 'svg' | 'back') {
    const ids = idsOf(look, slot);
    const pieces = piecesOf(look, slot);
    return pieces.map((piece, i) => {
      const markup = piece[which]?.replaceAll('url(#headClip)', `url(#${clipId})`);
      if (!markup) return null;
      return (
        <g
          key={`${which}-${slot}-${ids[i]}-${i}`}
          className={styles.slot}
          data-slot={slot}
          data-piece={ids[i]}
          data-layer={which}
          data-talks={piece.talks || undefined}
          style={{ '--c': colorOf(look, slot, ids[i]) } as CSSProperties}
        >
          <g className={styles.anim}>
            {look.sticker && (
              <g className={styles.sticker} dangerouslySetInnerHTML={{ __html: markup }} />
            )}
            <g className={styles.piece} dangerouslySetInnerHTML={{ __html: markup }} />
          </g>
        </g>
      );
    });
  }

  return (
    <svg
      viewBox="0 0 320 300"
      className={className ? `${styles.figure} ${className}` : styles.figure}
      data-speaking={speaking || undefined}
      data-animated={animated || undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-testid="avatar-figure"
    >
      <defs>
        <mask id={maskId}>
          <rect width="320" height="300" fill="#fff" />
          <circle cx="160" cy="118" r="70" fill="#000" />
        </mask>
        <clipPath id={clipId}>
          <circle cx="160" cy="118" r="56" />
        </clipPath>
      </defs>
      {DRAW_ORDER.map((slot) => layer(slot, 'back'))}
      <path
        className={styles.silhouette}
        mask={`url(#${maskId})`}
        d="M63 266 Q64 204 123 184 Q160 196 197 184 Q256 204 257 266 Q257 274 249 274 L71 274 Q63 274 63 266 Z"
      />
      <circle className={styles.silhouette} cx="160" cy="118" r="56" />
      {DRAW_ORDER.map((slot) => layer(slot, 'svg'))}
    </svg>
  );
}
