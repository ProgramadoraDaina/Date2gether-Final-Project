'use client';

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { isLoggedIn, onAuthChange } from '@/lib/auth';
import { loginUrlFor } from './safeRedirect';

// Besides token changes (this tab, other tabs), a page restored from the
// back/forward cache keeps its old React state, so `pageshow` forces a re-check.
function subscribe(callback: () => void): () => void {
  const stopAuth = onAuthChange(callback);
  const handlePageShow = (e: PageTransitionEvent) => {
    if (e.persisted) callback();
  };
  window.addEventListener('pageshow', handlePageShow);
  return () => {
    stopAuth();
    window.removeEventListener('pageshow', handlePageShow);
  };
}

// Tokens live in localStorage, so the server cannot know the session: the
// snapshot is `null` until hydration and nothing private renders before that.
export function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const loggedIn = useSyncExternalStore(subscribe, isLoggedIn, () => null);

  useEffect(() => {
    if (loggedIn !== false) return;
    router.replace(loginUrlFor(window.location.pathname + window.location.search));
  }, [loggedIn, router]);

  return loggedIn ? <>{children}</> : null;
}
