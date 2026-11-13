import { useCallback, useEffect, useState } from 'react';
import { ApiError, getRoomEmojis, type RoomEmoji } from '@/lib/api';

export function useRoomEmojis(code: string | undefined) {
  const [emojis, setEmojis] = useState<RoomEmoji[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refetchEmojis = useCallback(() => {
    if (!code) return Promise.resolve();
    return getRoomEmojis(code).then(
      (next) => {
        setEmojis(next);
        setError(null);
      },
      (err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los emojis');
      },
    );
  }, [code]);

  useEffect(() => {
    void refetchEmojis();
  }, [refetchEmojis]);

  return { emojis, error, refetchEmojis };
}
