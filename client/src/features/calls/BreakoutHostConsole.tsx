'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../translation/useTranslation';
import {
  closeAllBreakoutRooms,
  closeBreakoutRoom,
  createBreakoutRoom,
  isAdminBreakoutView,
  listBreakoutRooms,
  moveToBreakoutRoom,
  returnFromBreakoutRoom,
  updateBreakoutRoomPolicy,
  type BreakoutRoomAdminView,
  type JoinPolicy,
  type LeavePolicy,
} from '@/lib/breakouts';
import styles from './BreakoutHostConsole.module.css';

export interface BreakoutHostConsoleParticipant {
  livekitIdentity: string;
  displayName: string;
}

interface BreakoutHostConsoleProps {
  roomCode: string;
  roomToken: string;
  // Presencia CRUDA de la sala principal (page.tsx:breakoutParticipants):
  // incluye a TODOS los conectados al socket, incluidos los que ya tienen
  // una asignación abierta en una mini sala (siguen en el mismo socket
  // room, D7) y al propio admin. La consola calcula la resta.
  participants: BreakoutHostConsoleParticipant[];
  // Decisión 5 (design.md): identity propia, para filtrar la fila del
  // admin del selector genérico y para la acción separada de
  // auto-traslado -- mismo patrón que PollPanel (page.tsx:951).
  currentParticipantId: string;
}

// Consola solo-admin (Decisión 5, design.md): sala principal con
// ocupantes, cada mini sala con su roster, dos toggles de política
// rotulados distinto, timer, traslado (selector genérico sin la fila
// propia + auto-traslado explícito), cerrar una/todas, devolver a todos.
// El tope en sí (MAX_BREAKOUT_ROOMS) no se duplica del lado del cliente:
// el mensaje que se muestra es el que ya devuelve el backend al rechazar
// la creación (409/503), mismo criterio que el resto de los paneles de
// esta sala (ver RoomEventButton.tsx).
export function BreakoutHostConsole({
  roomCode,
  roomToken,
  participants,
  currentParticipantId,
}: BreakoutHostConsoleProps) {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<BreakoutRoomAdminView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedParticipant, setSelectedParticipant] = useState('');
  const [autoCloseInMinutes, setAutoCloseInMinutes] = useState('');

  const refresh = useCallback(async () => {
    try {
      const result = await listBreakoutRooms(roomCode, roomToken);
      // Esta consola es exclusivamente admin -- resolveRole del backend ya
      // garantiza que, para un admin, cada entrada es la vista completa
      // (Decisión 4). El filtro es defensivo: nunca debería descartar nada
      // en producción.
      setRooms(result.filter(isAdminBreakoutView));
    } catch {
      // El listado se reintenta en la próxima acción; no tapa el panel con
      // un error permanente por una falla de red puntual.
    }
  }, [roomCode, roomToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Decisión 4 (design.md "Proyección de list por rol"): la única resta
  // posible para invitados es por sourceIdentity (participantId de
  // presencia = participant.sub = sourceIdentity, ver page.tsx:293-297) --
  // nunca por userId, que no existe para invitados.
  const assignedSourceIdentities = useMemo(
    () => new Set(rooms.flatMap((room) => room.occupants.map((occupant) => occupant.sourceIdentity))),
    [rooms],
  );
  const principalOccupants = useMemo(
    () => participants.filter((participant) => !assignedSourceIdentities.has(participant.livekitIdentity)),
    [participants, assignedSourceIdentities],
  );
  // Decisión 5: la fila propia nunca aparece en el selector genérico --
  // se ofrece como acción separada ("Trasladarme acá") para que nunca haya
  // una fila duplicada ni ambigua.
  const transferCandidates = useMemo(
    () => participants.filter((participant) => participant.livekitIdentity !== currentParticipantId),
    [participants, currentParticipantId],
  );

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

  async function handleToggleLeavePolicy(room: BreakoutRoomAdminView) {
    const nextPolicy: LeavePolicy = room.leavePolicy === 'locked' ? 'free_return' : 'locked';
    setError(null);
    try {
      await updateBreakoutRoomPolicy(roomCode, roomToken, room.id, { leavePolicy: nextPolicy });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('No se pudo cambiar la política'));
    }
  }

  // Decisión 3 (design.md "joinPolicy"): control separado de leavePolicy
  // -- nunca manda leavePolicy en este patch, aunque ambos vivan en la
  // misma fila.
  async function handleToggleJoinPolicy(room: BreakoutRoomAdminView) {
    const nextPolicy: JoinPolicy = room.joinPolicy === 'open' ? 'admin_only' : 'open';
    setError(null);
    try {
      await updateBreakoutRoomPolicy(roomCode, roomToken, room.id, { joinPolicy: nextPolicy });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('No se pudo cambiar la política'));
    }
  }

  async function handleMoveIn(breakoutId: string, livekitIdentity: string) {
    if (!livekitIdentity) return;
    setError(null);
    try {
      await moveToBreakoutRoom(roomCode, roomToken, breakoutId, livekitIdentity);
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
      <div className={styles.principalPane} data-testid="breakout-principal-pane">
        <span className={styles.principalLabel}>{t('Sala principal')}</span>
        <ul className={styles.principalList}>
          {principalOccupants.map((occupant) => (
            <li key={occupant.livekitIdentity}>{occupant.displayName}</li>
          ))}
        </ul>
      </div>
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
                <ul className={styles.occupantList}>
                  {room.occupants.map((occupant) => (
                    <li key={occupant.livekitIdentity}>{occupant.displayName}</li>
                  ))}
                </ul>
                <button type="button" onClick={() => handleToggleLeavePolicy(room)}>
                  {room.leavePolicy === 'locked'
                    ? t('Permitir volver libremente')
                    : t('Bloquear retorno')}
                </button>
                <button type="button" onClick={() => handleToggleJoinPolicy(room)}>
                  {room.joinPolicy === 'open'
                    ? t('Requerir administrador para ingresar')
                    : t('Permitir auto-ingreso')}
                </button>
                <select
                  aria-label={`${t('Trasladar a')} ${room.label}`}
                  value={selectedParticipant}
                  onChange={(event) => setSelectedParticipant(event.target.value)}
                >
                  <option value="">{t('Elegí a quién trasladar')}</option>
                  {transferCandidates.map((participant) => (
                    <option key={participant.livekitIdentity} value={participant.livekitIdentity}>
                      {participant.displayName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleMoveIn(room.id, selectedParticipant)}
                  disabled={!selectedParticipant}
                >
                  {t('Trasladar')}
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveIn(room.id, currentParticipantId)}
                >
                  {t('Trasladarme acá')}
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
