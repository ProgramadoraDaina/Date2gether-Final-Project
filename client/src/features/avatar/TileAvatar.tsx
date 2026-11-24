'use client';

import { useIsSpeaking } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { createPortal } from 'react-dom';
import { AvatarFigure } from './AvatarFigure';
import { useParticipantAvatar } from './directoryContext';
import styles from './TileAvatar.module.css';

interface TileAvatarProps {
  participant: Participant;
  placeholder: Element;
}

// Se monta dentro del placeholder de LiveKit, que ya se muestra solo con la cámara apagada.
export function TileAvatar({ participant, placeholder }: TileAvatarProps) {
  const avatar = useParticipantAvatar(avatarIdentityOf(participant));
  const speaking = useIsSpeaking(participant);
  return createPortal(
    <AvatarFigure avatar={avatar} speaking={speaking} className={styles.figure} />,
    placeholder,
  );
}

// En una mini sala la identity es nueva; el token trae la de la sala principal.
export function avatarIdentityOf(participant: Pick<Participant, 'identity' | 'metadata'>): string {
  if (!participant.metadata) return participant.identity;
  try {
    const parsed = JSON.parse(participant.metadata) as { sourceIdentity?: unknown };
    return typeof parsed.sourceIdentity === 'string' ? parsed.sourceIdentity : participant.identity;
  } catch {
    return participant.identity;
  }
}
