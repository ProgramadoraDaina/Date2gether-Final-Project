'use client';

import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { LeavePolicy } from '@/lib/breakouts';

// Mini salas (breakout-rooms, D12 de su design.md): la señal viaja por el
// socket de sala, el token de LiveKit nunca -- se pide por HTTP autenticado
// (issueBreakoutToken en lib/breakouts.ts) una vez que llega esta señal.
export interface BreakoutAssignment {
  breakoutId: string;
  label: string;
  leavePolicy: LeavePolicy;
}

// Decisión 2 (design.md "Señal de motivo de remoción"): el servidor emite
// esta señal ANTES de la remoción forzada que la provoca (moveIn,
// selfReturn admin, expulsión locked). "BreakoutRemovalReason" se
// re-declara acá en vez de importarse del backend -- el cliente no
// comparte ese módulo.
export type BreakoutRemovalReason =
  | 'BREAKOUT_MOVE_IN'
  | 'BREAKOUT_FORCED_RETURN'
  | 'BREAKOUT_RETURN_LOCKED';

export interface BreakoutRemovalNotice {
  reason: BreakoutRemovalReason;
  at: number;
}

// Ventana de frescura (design.md "Lectura en el cliente"): un aviso viejo
// no debe tapar un fallo de red posterior en onDisconnected.
const REMOVAL_NOTICE_FRESHNESS_MS = 10_000;

export interface UseRoomSocketResult {
  breakoutAssignment: BreakoutAssignment | null;
  // Se incrementa cada vez que llega 'breakout:closed' para la mini sala
  // actualmente asignada: dispara el camino de retorno sin confundir "nunca
  // llegó" con "llegó una vez". El consumidor reacciona en un efecto que
  // depende de este valor (breakoutAssignment ya quedó en null en el mismo
  // cambio de estado, así que no sirve por sí solo como disparador).
  breakoutReturnSignal: number;
  // Decisión 2 (design.md): lectura DESTRUCTIVA, respaldada por un ref (no
  // por estado) -- onDisconnected dispara a milisegundos del evento de
  // socket; un setState puede no haber flusheado todavía, y leer estado
  // stale clasificaría una expulsión legítima como fallo genérico
  // (fail-open en el caso sensible). null si no hay aviso, o si el aviso ya
  // venció (más de REMOVAL_NOTICE_FRESHNESS_MS de antigüedad).
  consumeRemovalNotice: () => BreakoutRemovalNotice | null;
}

// Mismo patrón que useRoomMediaLock.ts: un hook por tipo de aviso, todos
// escuchando el mismo socket de sala ya conectado (ver lib/socket.ts).
export function useRoomSocket(socket: Socket | null): UseRoomSocketResult {
  const [breakoutAssignment, setBreakoutAssignment] = useState<BreakoutAssignment | null>(null);
  const [breakoutReturnSignal, setBreakoutReturnSignal] = useState(0);
  // Espejo síncrono del estado dentro del mismo efecto: evita depender de
  // `breakoutAssignment` en el arreglo de dependencias del efecto (eso
  // reengancharía los listeners en cada asignación/cierre) y evita leer un
  // valor de estado stale desde dentro del propio handler.
  const assignmentRef = useRef<BreakoutAssignment | null>(null);
  // Decisión 2 (design.md): nunca por estado -- ver el comentario de
  // consumeRemovalNotice en UseRoomSocketResult.
  const removalNoticeRef = useRef<BreakoutRemovalNotice | null>(null);

  useEffect(() => {
    if (!socket) return;
    function onBreakoutAssigned(payload: BreakoutAssignment) {
      assignmentRef.current = payload;
      setBreakoutAssignment(payload);
    }
    function onBreakoutClosed(payload: { breakoutId: string }) {
      // El cierre se transmite a toda la sala (ver chat.gateway.ts): solo
      // dispara el retorno si coincide con la mini sala que este cliente
      // tiene asignada ahora mismo.
      if (assignmentRef.current?.breakoutId !== payload.breakoutId) return;
      assignmentRef.current = null;
      setBreakoutAssignment(null);
      setBreakoutReturnSignal((count) => count + 1);
    }
    function onBreakoutRemoval(payload: { reason: BreakoutRemovalReason }) {
      removalNoticeRef.current = { reason: payload.reason, at: Date.now() };
    }
    socket.on('breakout:assigned', onBreakoutAssigned);
    socket.on('breakout:closed', onBreakoutClosed);
    socket.on('breakout:removal', onBreakoutRemoval);
    return () => {
      socket.off('breakout:assigned', onBreakoutAssigned);
      socket.off('breakout:closed', onBreakoutClosed);
      socket.off('breakout:removal', onBreakoutRemoval);
    };
  }, [socket]);

  function consumeRemovalNotice(): BreakoutRemovalNotice | null {
    const notice = removalNoticeRef.current;
    removalNoticeRef.current = null; // lectura destructiva, sin importar frescura
    if (!notice) return null;
    if (Date.now() - notice.at > REMOVAL_NOTICE_FRESHNESS_MS) return null;
    return notice;
  }

  return { breakoutAssignment, breakoutReturnSignal, consumeRemovalNotice };
}
