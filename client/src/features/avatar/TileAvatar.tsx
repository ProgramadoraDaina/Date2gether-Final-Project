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
  const avatar = useParticipantAvatar(participant.identity);
  const speaking = useIsSpeaking(participant);
  return createPortal(
    <AvatarFigure avatar={avatar} speaking={speaking} className={styles.figure} />,
    placeholder,
  );
}
