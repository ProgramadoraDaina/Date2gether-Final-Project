'use client';

import type { ReactNode } from 'react';
import type { Avatar } from './catalog';
import { AvatarDirectoryContext } from './directoryContext';

export function AvatarDirectoryProvider({
  directory,
  children,
}: {
  directory: ReadonlyMap<string, Avatar>;
  children: ReactNode;
}) {
  return (
    <AvatarDirectoryContext.Provider value={directory}>{children}</AvatarDirectoryContext.Provider>
  );
}
