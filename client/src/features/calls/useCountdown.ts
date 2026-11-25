'use client';

import { useEffect, useState } from 'react';

function secondsUntil(target: string | null): number | null {
  if (!target) return null;
  return Math.max(0, Math.ceil((new Date(target).getTime() - Date.now()) / 1000));
}

export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function useCountdown(target: string | null): number | null {
  const [left, setLeft] = useState(() => secondsUntil(target));
  useEffect(() => {
    setLeft(secondsUntil(target));
    if (!target) return;
    const timer = setInterval(() => setLeft(secondsUntil(target)), 250);
    return () => clearInterval(timer);
  }, [target]);
  return left;
}
