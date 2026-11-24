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
  recallBreakoutRooms,
  returnFromBreakoutRoom,
  updateBreakoutRoomPolicy,
  type BreakoutRoomAdminView,
  type JoinPolicy,
  type LeavePolicy,
} from '@/lib/breakouts';
import { formatCountdown, useCountdown } from './useCountdown';
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
    // Los cierres por cuenta regresiva ocurren en el servidor: se reflejan sin acción del admin.
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const [recallIds, setRecallIds] = useState<string[] | null>(null);
  const [recallSeconds, setRecallSeconds] = useState(30);
  const selectedRecallIds = recallIds ?? rooms.map((room) => room.id);
  const allSelected =
    rooms.length > 0 && rooms.every((room) => selectedRecallIds.includes(room.id));

  function toggleRecallRoom(id: string) {
    setRecallIds(
      selectedRecallIds.includes(id)
        ? selectedRecallIds.filter((current) => current !== id)
        : [...selectedRecallIds, id],
    );
  }

  async function handleRecall() {
    setError(null);
    try {
      await recallBreakoutRooms(roomCode, roomToken, {
        breakoutIds: allSelected ? undefined : selectedRecallIds,
        inSeconds: recallSeconds,
      });
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('No se pudo llamar de vuelta a las mini salas'),
      );
    }
  }

  // Decisión 4 (design.md "Proyección de list por rol"): la única resta
  // posible para invitados es por sourceIdentity (participantId de
  // presencia = participant.sub = sourceIdentity, ver page.tsx:293-297) --
  // nunca por userId, que no existe para invitados.
  const assignedSourceIdentities = useMemo(
    () =>
      new Set(rooms.flatMap((room) => room.occupants.map((occupant) => occupant.sourceIdentity))),
    [rooms],
  );
  const principalOccupants = useMemo(
    () =>
      participants.filter(
        (participant) => !assignedSourceIdentities.has(participant.livekitIdentity),
      ),
    [participants, assignedSourceIdentities],
  );
  // Decisión 5: la fila propia nunca aparece en el selector genérico --
  // se ofrece como acción separada ("Trasladarme acá") para que nunca haya
  // una fila duplicada ni ambigua.
  const transferCandidates = useMemo(
    () =>
      participants.filter((participant) => participant.livekitIdentity !== currentParticipantId),
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
      <header className={styles.header}>
        <h3>{t('Mini salas')}</h3>
        <span className={styles.meta}>
          {rooms.length} {t('abiertas')}
        </span>
        <div className={styles.spacer} />
        <div className={styles.createCard}>
          <input
            type="number"
            min={1}
            placeholder={t('Minutos (opcional)')}
            aria-label={t('Cierre automático en minutos')}
            value={autoCloseInMinutes}
            onChange={(event) => setAutoCloseInMinutes(event.target.value)}
          />
          <button type="button" className={styles.createButton} onClick={handleCreate}>
            {t('Crear mini sala')}
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.board}>
        <div className={styles.principalPane} data-testid="breakout-principal-pane">
          <div className={styles.columnHeader}>
            <span className={styles.principalLabel}>{t('Sala principal')}</span>
            <span className={styles.meta}>{principalOccupants.length}</span>
          </div>
          <ul className={styles.principalList}>
            {principalOccupants.map((occupant) => (
              <li key={occupant.livekitIdentity}>
                <span className={styles.initials} aria-hidden="true">
                  {occupant.displayName.slice(0, 2).toUpperCase()}
                </span>
                {occupant.displayName}
              </li>
            ))}
          </ul>
        </div>
        {rooms.length === 0 ? (
          <p className={styles.empty}>{t('Todavía no hay mini salas abiertas.')}</p>
        ) : (
          <ul className={styles.roomList}>
            {rooms.map((room) => (
              <li key={room.id} className={styles.roomRow}>
                <RoomCountdown closesAt={room.autoCloseAt} />
                <div className={styles.columnHeader}>
                  <span className={styles.roomLabel}>{room.label}</span>
                  <span className={styles.roomCounter}>
                    {room.occupants.length === 1
                      ? t('1 participante')
                      : `${room.occupants.length} ${t('participantes')}`}
                  </span>
                </div>
                <ul className={styles.occupantList}>
                  {room.occupants.map((occupant) => (
                    <li key={occupant.livekitIdentity}>
                      <span className={styles.initials} aria-hidden="true">
                        {occupant.displayName.slice(0, 2).toUpperCase()}
                      </span>
                      {occupant.displayName}
                    </li>
                  ))}
                </ul>
                <div className={styles.roomControls}>
                  <button
                    type="button"
                    className={`${styles.policyBadge} ${
                      room.leavePolicy === 'locked' ? styles.locked : styles.open
                    }`}
                    onClick={() => handleToggleLeavePolicy(room)}
                  >
                    {room.leavePolicy === 'locked'
                      ? t('Permitir volver libremente')
                      : t('Bloquear retorno')}
                  </button>
                  <button
                    type="button"
                    className={`${styles.policyBadge} ${
                      room.joinPolicy === 'open' ? styles.open : styles.locked
                    }`}
                    onClick={() => handleToggleJoinPolicy(room)}
                  >
                    {room.joinPolicy === 'open'
                      ? t('Requerir administrador para ingresar')
                      : t('Permitir auto-ingreso')}
                  </button>
                  <div className={styles.transferArea}>
                    <select
                      className={styles.select}
                      aria-label={`${t('Trasladar a')} ${room.label}`}
                      value={selectedParticipant}
                      onChange={(event) => setSelectedParticipant(event.target.value)}
                    >
                      <option value="">{t('Elegí a quién trasladar')}</option>
                      {transferCandidates.map((participant) => (
                        <option
                          key={participant.livekitIdentity}
                          value={participant.livekitIdentity}
                        >
                          {participant.displayName}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={`${styles.button} ${styles.primary}`}
                      onClick={() => handleMoveIn(room.id, selectedParticipant)}
                      disabled={!selectedParticipant}
                    >
                      {t('Trasladar')}
                    </button>
                  </div>
                  <div className={styles.roomActions}>
                    <button
                      type="button"
                      className={styles.button}
                      onClick={() => handleMoveIn(room.id, currentParticipantId)}
                    >
                      {t('Trasladarme acá')}
                    </button>
                    <button
                      type="button"
                      className={`${styles.button} ${styles.danger}`}
                      onClick={() => handleClose(room.id)}
                    >
                      {t('Cerrar')}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {rooms.length > 0 && (
        <footer className={styles.recallBar}>
          <span className={styles.recallTitle}>{t('Llamar de vuelta')}</span>
          <div className={styles.chips} role="group" aria-label={t('Salas a llamar')}>
            {rooms.map((room) => (
              <button
                key={room.id}
                type="button"
                className={styles.chip}
                aria-pressed={selectedRecallIds.includes(room.id)}
                onClick={() => toggleRecallRoom(room.id)}
              >
                {room.label}
              </button>
            ))}
            <button
              type="button"
              className={styles.chip}
              aria-pressed={allSelected}
              onClick={() => setRecallIds(allSelected ? [] : rooms.map((room) => room.id))}
            >
              {t('Todas')}
            </button>
          </div>
          <span className={styles.meta}>{t('en')}</span>
          <div className={styles.segmented} role="group" aria-label={t('Segundos de aviso')}>
            {RECALL_SECONDS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                aria-pressed={recallSeconds === seconds}
                onClick={() => setRecallSeconds(seconds)}
              >
                {seconds} s
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={handleRecall}
            disabled={selectedRecallIds.length === 0}
          >
            {t('Llamar en')} {recallSeconds} s
          </button>
          <div className={styles.spacer} />
          <button type="button" className={styles.button} onClick={handleReturnAll}>
            {t('Devolver a todos')}
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.danger}`}
            onClick={handleCloseAll}
          >
            {t('Cerrar todas')}
          </button>
        </footer>
      )}
    </div>
  );
}

const RECALL_SECONDS = [10, 30, 60];

function RoomCountdown({ closesAt }: { closesAt: string | null }) {
  const { t } = useTranslation();
  const left = useCountdown(closesAt);
  if (left === null) return null;
  return (
    <div className={styles.countdown} role="timer">
      <span>{t('Vuelven en')}</span>
      <span className={styles.clock}>{formatCountdown(left)}</span>
    </div>
  );
}
