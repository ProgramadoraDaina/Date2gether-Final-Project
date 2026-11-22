'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../translation/useTranslation';
import {
  closeAllBreakoutRooms,
  closeBreakoutRoom,
  createBreakoutRoom,
  listBreakoutRooms,
  moveToBreakoutRoom,
  returnFromBreakoutRoom,
  updateBreakoutRoomPolicy,
  type BreakoutRoom,
  type LeavePolicy,
} from '@/lib/breakouts';
import styles from './BreakoutPanel.module.css';

export interface BreakoutPanelParticipant {
  livekitIdentity: string;
  displayName: string;
}

interface BreakoutPanelProps {
  roomCode: string;
  roomToken: string;
  // Gente actualmente conectada a la sala principal, elegible para
  // trasladar. Lo decide quien monte el panel (todavía no cableado a
  // RoomPage en esta fase): esta pieza solo necesita la lista, no cómo se
  // armó.
  participants: BreakoutPanelParticipant[];
}

// Panel solo-admin (design.md, tabla de Cliente): crear bajo tope con
// mensaje de error cuando se alcanza, toggle de política, timer opcional,
// elegir participante para trasladar, cerrar una o todas, "devolver a
// todos". El tope en sí (MAX_BREAKOUT_ROOMS) no se duplica del lado del
// cliente: el mensaje que se muestra es el que ya devuelve el backend al
// rechazar la creación (409/503), mismo criterio que el resto de los
// paneles de esta sala (ver RoomEventButton.tsx).
export function BreakoutPanel({ roomCode, roomToken, participants }: BreakoutPanelProps) {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<BreakoutRoom[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedParticipant, setSelectedParticipant] = useState('');
  const [autoCloseInMinutes, setAutoCloseInMinutes] = useState('');

  const refresh = useCallback(async () => {
    try {
      setRooms(await listBreakoutRooms(roomCode, roomToken));
    } catch {
      // El listado se reintenta en la próxima acción; no tapa el panel con
      // un error permanente por una falla de red puntual.
    }
  }, [roomCode, roomToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate() {
    setError(null);
    try {
      const minutes = autoCloseInMinutes.trim() ? Number(autoCloseInMinutes) : undefined;
      await createBreakoutRoom(roomCode, roomToken, {
        autoCloseInMinutes: minutes && minutes > 0 ? minutes : undefined,
      });
      setAutoCloseInMinutes('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('No se pudo crear la mini sala'));
    }
  }

  async function handleTogglePolicy(room: BreakoutRoom) {
    const nextPolicy: LeavePolicy = room.leavePolicy === 'locked' ? 'free_return' : 'locked';
    setError(null);
    try {
      await updateBreakoutRoomPolicy(roomCode, roomToken, room.id, { leavePolicy: nextPolicy });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('No se pudo cambiar la política'));
    }
  }

  async function handleMoveIn(breakoutId: string) {
    if (!selectedParticipant) return;
    setError(null);
    try {
      await moveToBreakoutRoom(roomCode, roomToken, breakoutId, selectedParticipant);
      setSelectedParticipant('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('No se pudo trasladar al participante'));
    }
  }

  async function handleClose(breakoutId: string) {
    setError(null);
    try {
      await closeBreakoutRoom(roomCode, roomToken, breakoutId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('No se pudo cerrar la mini sala'));
    }
  }

  async function handleCloseAll() {
    setError(null);
    try {
      await closeAllBreakoutRooms(roomCode, roomToken);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('No se pudieron cerrar las mini salas'));
    }
  }

  // "Devolver a todos" (design.md, tabla de Cliente): distinto de cerrar --
  // vuelve a cada ocupante a la principal sin desarmar las mini salas, así
  // el admin puede seguir usándolas. Fuerza el retorno vía el camino
  // admin de selfReturn (bypassea `locked`, igual que "Administrador
  // devuelve a un ocupante" en el spec).
  async function handleReturnAll() {
    setError(null);
    try {
      for (const room of rooms) {
        for (const occupant of room.occupants) {
          await returnFromBreakoutRoom(roomCode, roomToken, room.id, occupant.livekitIdentity);
        }
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('No se pudo devolver a todos'));
    }
  }

  return (
    <div className={styles.panel}>
      <h3>{t('Mini salas')}</h3>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.createRow}>
        <input
          type="number"
          min={1}
          placeholder={t('Minutos (opcional)')}
          aria-label={t('Cierre automático en minutos')}
          value={autoCloseInMinutes}
          onChange={(event) => setAutoCloseInMinutes(event.target.value)}
        />
        <button type="button" onClick={handleCreate}>
          {t('Crear mini sala')}
        </button>
      </div>
      {rooms.length === 0 ? (
        <p className={styles.empty}>{t('Todavía no hay mini salas abiertas.')}</p>
      ) : (
        <>
          <button type="button" onClick={handleReturnAll}>
            {t('Devolver a todos')}
          </button>
          <ul className={styles.roomList}>
            {rooms.map((room) => (
              <li key={room.id} className={styles.roomRow}>
                <span className={styles.roomLabel}>{room.label}</span>
                <button type="button" onClick={() => handleTogglePolicy(room)}>
                  {room.leavePolicy === 'locked'
                    ? t('Permitir volver libremente')
                    : t('Bloquear retorno')}
                </button>
                <select
                  aria-label={`${t('Trasladar a')} ${room.label}`}
                  value={selectedParticipant}
                  onChange={(event) => setSelectedParticipant(event.target.value)}
                >
                  <option value="">{t('Elegí a quién trasladar')}</option>
                  {participants.map((participant) => (
                    <option key={participant.livekitIdentity} value={participant.livekitIdentity}>
                      {participant.displayName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleMoveIn(room.id)}
                  disabled={!selectedParticipant}
                >
                  {t('Trasladar')}
                </button>
                <button type="button" onClick={() => handleClose(room.id)}>
                  {t('Cerrar')}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={handleCloseAll}>
            {t('Cerrar todas')}
          </button>
        </>
      )}
    </div>
  );
}
