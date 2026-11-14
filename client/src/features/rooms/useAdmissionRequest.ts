import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ApiError,
  cancelAdmissionRequest,
  getAdmissionStatus,
  type RoomAccess,
  type WaitingRoomReceipt,
} from '@/lib/api';

type Status = 'pending' | 'rejected' | 'cancelled' | 'expired';
interface State {
  code: string;
  receipt: WaitingRoomReceipt | null | undefined;
  status: Status;
  error: string | null;
  cancelling: boolean;
  cancelIntent: boolean;
  refresh: number;
}
const initial = (code: string): State => ({
  code,
  receipt: undefined,
  status: 'pending',
  error: null,
  cancelling: false,
  cancelIntent: false,
  refresh: 0,
});
const subscribe = (listener: () => void) => {
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
};
const serverSnapshot = () => null;

export function useAdmissionRequest(code: string, onAdmitted: (access: RoomAccess) => void) {
  const key = 'date2gether:waiting:' + code;
  const snapshot = useCallback(() => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const saved = useMemo(() => {
    try {
      const value = JSON.parse(raw ?? 'null') as WaitingRoomReceipt | null;
      return value?.status === 'pending' &&
        typeof value.requestId === 'string' &&
        typeof value.ticket === 'string'
        ? value
        : null;
    } catch {
      return null;
    }
  }, [raw]);
  const [state, setState] = useState(() => initial(code));
  const currentState = state.code === code ? state : initial(code);
  const receipt = currentState.receipt === undefined ? saved : currentState.receipt;
  const { status, error, cancelling, cancelIntent, refresh } = currentState;
  const patch = useCallback(
    (changes: Partial<State>) => {
      setState((previous) => ({
        ...(previous.code === code ? previous : initial(code)),
        ...changes,
      }));
    },
    [code],
  );
  const generation = useRef(0);
  const clearStorage = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* La espera funciona también sin storage. */
    }
  }, [key]);

  const start = useCallback(
    (next: WaitingRoomReceipt) => {
      generation.current++;
      patch({ receipt: next, status: 'pending', error: null, cancelIntent: false });
      try {
        sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* Se conserva en memoria. */
      }
    },
    [key, patch],
  );

  useEffect(() => {
    if (!receipt || status !== 'pending' || cancelIntent) return;
    const current = ++generation.current;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const valid = () => current === generation.current && !controller.signal.aborted;
    async function poll() {
      let delay = 5000;
      try {
        const result = await getAdmissionStatus(code, receipt!, controller.signal);
        if (!valid()) return;
        if (result.status === 'admitted') {
          clearStorage();
          patch({ receipt: null, error: null });
          onAdmitted(result.access);
          return;
        }
        patch({ receipt, status: result.status, error: null });
        if (result.status !== 'pending') {
          clearStorage();
          return;
        }
      } catch (cause) {
        if (!valid()) return;
        delay = 15000;
        patch({
          receipt,
          error:
            cause instanceof ApiError
              ? cause.message
              : 'No se pudo consultar la solicitud. Reintentando…',
        });
      }
      if (valid())
        timer = setTimeout(() => {
          void poll();
        }, delay);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [receipt, status, cancelIntent, code, refresh, clearStorage, onAdmitted, patch]);

  async function cancel() {
    if (!receipt || cancelling) return;
    generation.current++;
    patch({ cancelIntent: true, cancelling: true, error: null });
    try {
      await cancelAdmissionRequest(code, receipt);
      clearStorage();
      patch({ receipt: null, status: 'pending', cancelIntent: false });
    } catch (cause) {
      patch({
        error:
          cause instanceof ApiError
            ? cause.message
            : 'No se pudo cancelar. Reintentá la cancelación.',
      });
    } finally {
      patch({ cancelling: false });
    }
  }

  function reset() {
    generation.current++;
    clearStorage();
    patch({ receipt: null, error: null, status: 'pending', cancelIntent: false });
  }
  return {
    receipt,
    status,
    error,
    cancelling,
    cancelIntent,
    start,
    cancel,
    reset,
    retry: () => patch({ refresh: refresh + 1 }),
  };
}
