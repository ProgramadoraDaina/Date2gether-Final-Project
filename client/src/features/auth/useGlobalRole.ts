'use client';

import { useCallback, useEffect, useState } from 'react';
import { getCurrentUserOrThrow, isLoggedIn, onAuthChange, type UserRole } from '@/lib/auth';

// 'error' = hay sesión pero no se pudo averiguar el rol (red, 5xx). No es lo mismo que 'user':
// tratarlo como tal le mostraría "Sin acceso" a un admin por un fallo transitorio.
export type GlobalRoleState = 'loading' | 'anonymous' | 'error' | UserRole;

export interface GlobalAccount {
  role: GlobalRoleState;
  userId: string | null;
  // Vuelve a pedir /auth/me (para el botón "Reintentar" tras un 'error').
  reload: () => void;
}

// Rol global de la cuenta, leído de /auth/me. Es solo para mostrar u ocultar UI:
// el backend revalida el rol en cada request a /admin/*.
export function useGlobalAccount(): GlobalAccount {
  const [state, setState] = useState<{ role: GlobalRoleState; userId: string | null }>({
    role: 'loading',
    userId: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    function load() {
      if (!isLoggedIn()) {
        setState({ role: 'anonymous', userId: null });
        return;
      }
      getCurrentUserOrThrow()
        .then((user) => {
          if (cancelled) return;
          // null = sin sesión (401 sin refresh posible): se trata como deslogueado.
          setState(
            user
              ? { role: user.role ?? 'user', userId: user.id }
              : { role: 'anonymous', userId: null },
          );
        })
        .catch(() => {
          if (!cancelled) setState({ role: 'error', userId: null });
        });
    }
    load();
    const stop = onAuthChange(load);
    return () => {
      cancelled = true;
      stop();
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ role: 'loading', userId: null });
    setAttempt((n) => n + 1);
  }, []);

  return { role: state.role, userId: state.userId, reload };
}

export function useGlobalRole(): GlobalRoleState {
  return useGlobalAccount().role;
}
