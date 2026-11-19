'use client';

import { createContext, useContext } from 'react';
import { toAvatar, type Avatar } from './catalog';

// identity de LiveKit (== participantId de la presencia del chat) -> avatar.
export const AvatarDirectoryContext = createContext<ReadonlyMap<string, Avatar>>(new Map());

export function buildAvatarDirectory(
  users: { participantId: string; avatar?: unknown }[],
): Map<string, Avatar> {
  const directory = new Map<string, Avatar>();
  for (const user of users) {
    const avatar = toAvatar(user.avatar);
    if (avatar) directory.set(user.participantId, avatar);
  }
  return directory;
}

export function useParticipantAvatar(identity: string | undefined): Avatar | undefined {
  const directory = useContext(AvatarDirectoryContext);
  return identity ? directory.get(identity) : undefined;
}
