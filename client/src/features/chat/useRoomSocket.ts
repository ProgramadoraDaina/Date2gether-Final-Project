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

export interface UseRoomSocketResult {
  breakoutAssignment: BreakoutAssignment | null;
  // Se incrementa cada vez que llega 'breakout:closed' para la mini sala
  // actualmente asignada: dispara el camino de retorno sin confundir "nunca
  // llegó" con "llegó una vez". El consumidor reacciona en un efecto que
  // depende de este valor (breakoutAssignment ya quedó en null en el mismo
  // cambio de estado, así que no sirve por sí solo como disparador).
  breakoutReturnSignal: number;
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
    socket.on('breakout:assigned', onBreakoutAssigned);
    socket.on('breakout:closed', onBreakoutClosed);
    return () => {
      socket.off('breakout:assigned', onBreakoutAssigned);
      socket.off('breakout:closed', onBreakoutClosed);
    };
  }, [socket]);

  return { breakoutAssignment, breakoutReturnSignal };
}
