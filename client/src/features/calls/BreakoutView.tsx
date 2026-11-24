'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from '../translation/useTranslation';
import { useDismiss } from '@/lib/useDismiss';
import { returnFromBreakoutRoom } from '@/lib/breakouts';
import type { BreakoutAssignment } from '../chat/useRoomSocket';
import { resolveBreakoutViewState } from './breakoutViewState';
import { BreakoutHostConsole, type BreakoutHostConsoleParticipant } from './BreakoutHostConsole';
import { BreakoutSelfStatus } from './BreakoutSelfStatus';
import styles from './BreakoutView.module.css';

function BreakoutRoomsIcon() {
  return (
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
  );
}

interface BreakoutViewProps {
  roomCode: string;
  roomToken: string;
  isCurrentUserAdmin: boolean;
  // Asignación propia vigente (useRoomSocket.breakoutAssignment), o null.
  assignment: BreakoutAssignment | null;
  // Presencia cruda de la sala principal (page.tsx:breakoutParticipants).
  participants: BreakoutHostConsoleParticipant[];
  currentParticipantId: string;
  // Clases opcionales para que el disparador combine visualmente con el
  // resto del dock (mismo patrón que CallSettingsButton.buttonClassName).
  buttonClassName?: string;
  activeButtonClassName?: string;
}

/**
 * Decisión 5 (design.md "Frontend: un punto de montaje y un selector puro
 * de 4 estados"): único punto de montaje para toda la UI de mini salas,
 * reemplazando la coexistencia BreakoutPanel+BreakoutBanner. Dueña de su
 * propio disparador y popover -- nunca renderiza dos vistas de mini sala
 * a la vez, en ninguno de los 4 estados.
 */
export function BreakoutView({
  roomCode,
  roomToken,
  isCurrentUserAdmin,
  assignment,
  participants,
  currentParticipantId,
  buttonClassName,
  activeButtonClassName,
}: BreakoutViewProps) {
  const { t } = useTranslation();
  const [panelOpen, setPanelOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  useDismiss(panelOpen, wrapRef, closePanel);

  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  // Autoservicio "Volver" (free_return, D8/design.md): breakout:closed solo
  // viaja cuando se cierra la mini sala entera -- un retorno individual vía
  // selfReturn no la dispara. La franja de estado propio se oculta
  // localmente por id en vez de depender de esa señal.
  const [returnedBreakoutId, setReturnedBreakoutId] = useState<string | null>(null);
  const visibleAssignment =
    assignment && assignment.breakoutId !== returnedBreakoutId ? assignment : null;

  const handleReturn = useCallback(async () => {
    if (!assignment) return;
    setReturning(true);
    setReturnError(null);
    try {
      await returnFromBreakoutRoom(roomCode, roomToken, assignment.breakoutId);
      setReturnedBreakoutId(assignment.breakoutId);
    } catch (cause) {
      setReturnError(cause instanceof Error ? cause.message : t('No se pudo volver a la sala principal'));
    } finally {
      setReturning(false);
    }
  }, [assignment, roomCode, roomToken, t]);

  const state = resolveBreakoutViewState({ isAdmin: isCurrentUserAdmin, assignment: visibleAssignment });

  if (state === 'guest-idle') {
    // Decisión 5 (design.md): "Nada, salvo que exista alguna sala abierta
    // con joinPolicy='open'" -- el selector mínimo de auto-ingreso vive
    // fuera de este lote (requiere su propio fetch de list() como
    // no-admin); por ahora el estado inactivo no renderiza nada, igual
    // que el comportamiento de hoy cuando no hay asignación.
    return null;
  }

  if (state === 'guest-occupant') {
    return (
      <>
        <BreakoutSelfStatus assignment={visibleAssignment!} onReturn={handleReturn} returning={returning} />
        {returnError && (
          <p role="alert" className={styles.error}>
            {returnError}
          </p>
        )}
      </>
    );
  }

  // host / host-occupant: la misma consola, con la franja de estado propio
  // renderizada DENTRO de ella cuando corresponde (host-occupant) -- nunca
  // como hermana. Es lo que vuelve estructuralmente inexpresable el bug de
  // Panel+Banner coexistiendo.
  return (
    <div className={styles.breakoutWrap} ref={wrapRef}>
      <button
        type="button"
        className={`${buttonClassName ?? ''} ${panelOpen && activeButtonClassName ? activeButtonClassName : ''}`}
        onClick={() => setPanelOpen((open) => !open)}
        title={t('Mini salas')}
        aria-label={t('Mini salas')}
        aria-expanded={panelOpen}
      >
        <BreakoutRoomsIcon />
      </button>
      {panelOpen && (
        <div className={styles.breakoutPanelPopover} role="dialog" aria-label={t('Mini salas')}>
          {state === 'host-occupant' && (
            <BreakoutSelfStatus
              assignment={visibleAssignment!}
              onReturn={handleReturn}
              returning={returning}
            />
          )}
          {returnError && (
            <p role="alert" className={styles.error}>
              {returnError}
            </p>
          )}
          <BreakoutHostConsole
            roomCode={roomCode}
            roomToken={roomToken}
            participants={participants}
            currentParticipantId={currentParticipantId}
          />
        </div>
      )}
    </div>
  );
}
