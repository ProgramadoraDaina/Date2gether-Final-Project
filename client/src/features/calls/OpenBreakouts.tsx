'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDismiss } from '@/lib/useDismiss';
import {
  isAdminBreakoutView,
  listBreakoutRooms,
  moveToBreakoutRoom,
  type BreakoutRoomPublicView,
} from '@/lib/breakouts';
import { useTranslation } from '../translation/useTranslation';
import styles from './BreakoutView.module.css';

const REFRESH_MS = 15_000;

// Mini salas a las que cualquiera puede entrar por su cuenta (joinPolicy 'open').
export function openBreakoutsOf(rooms: Awaited<ReturnType<typeof listBreakoutRooms>>) {
  return rooms.filter(
    (room): room is BreakoutRoomPublicView =>
      !isAdminBreakoutView(room) && room.joinPolicy === 'open' && !room.selfAssigned,
  );
}

interface OpenBreakoutsProps {
  roomCode: string;
  roomToken: string;
  currentParticipantId: string;
  buttonClassName?: string;
  activeButtonClassName?: string;
}

// Solo aparece cuando hay alguna mini sala abierta: no ocupa lugar en la barra el resto del tiempo.
export function OpenBreakouts({
  roomCode,
  roomToken,
  currentParticipantId,
  buttonClassName,
  activeButtonClassName,
}: OpenBreakoutsProps) {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<BreakoutRoomPublicView[]>([]);
  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, wrapRef, close);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      Promise.resolve()
        .then(() => listBreakoutRooms(roomCode, roomToken))
        .then((list) => {
          if (active) setRooms(openBreakoutsOf(list));
        })
        .catch(() => undefined);
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [roomCode, roomToken]);

  async function join(breakoutId: string) {
    setJoining(breakoutId);
    setError(null);
    try {
      // El traslado real llega después por el socket (breakout:assigned), como cuando te mueve un admin.
      await moveToBreakoutRoom(roomCode, roomToken, breakoutId, currentParticipantId);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('No se pudo entrar a la mini sala'));
    } finally {
      setJoining(null);
    }
  }

  if (rooms.length === 0) return null;
  const label = t('Mini salas abiertas');
  return (
    <div className={styles.breakoutWrap} ref={wrapRef}>
      <button
        type="button"
        className={`${buttonClassName ?? ''} ${open && activeButtonClassName ? activeButtonClassName : ''}`}
        onClick={() => setOpen((value) => !value)}
        title={label}
        aria-label={label}
        aria-expanded={open}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="10" height="10" rx="2" />
          <rect x="14" y="13" width="7" height="7" rx="1.5" />
        </svg>
        <span className={styles.openCount}>{rooms.length}</span>
      </button>
      {open && (
        <div className={styles.openPanel} role="dialog" aria-label={label}>
          <p className={styles.openTitle}>{label}</p>
          <ul className={styles.openList}>
            {rooms.map((room) => (
              <li key={room.id} className={styles.openRow}>
                <span>
                  <strong>{room.label}</strong>
                  <span className={styles.openMeta}>
                    {room.occupantCount} {t(room.occupantCount === 1 ? 'persona' : 'personas')}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.openJoin}
                  disabled={joining !== null}
                  aria-busy={joining === room.id}
                  onClick={() => void join(room.id)}
                >
                  {t('Entrar')}
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
