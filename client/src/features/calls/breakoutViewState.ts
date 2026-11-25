import type { BreakoutAssignment } from '../chat/useRoomSocket';

// Decisión 5 (design.md "Frontend: un punto de montaje y un selector puro
// de 4 estados"): colapsa los dos *gates* ortogonales que hoy producen
// BreakoutPanel+BreakoutBanner coexistiendo en un único selector puro, sin
// React -- testeable sin renderizar nada, y estructuralmente imposible de
// malusar para volver a producir dos vistas de mini sala a la vez.
export type BreakoutViewState = 'guest-idle' | 'guest-occupant' | 'host' | 'host-occupant';

export interface ResolveBreakoutViewStateInput {
  isAdmin: boolean;
  assignment: BreakoutAssignment | null;
}

/**
 * - `guest-idle`: no-admin, sin asignación.
 * - `guest-occupant`: no-admin, con asignación (estado propio solamente).
 * - `host`: admin, sin asignación (consola completa).
 * - `host-occupant`: admin, con asignación (la misma consola, MÁS una
 *   franja de estado propio renderizada DENTRO de ella -- nunca como
 *   hermana. Es lo que vuelve estructuralmente inexpresable el bug de hoy).
 */
export function resolveBreakoutViewState({
  isAdmin,
  assignment,
}: ResolveBreakoutViewStateInput): BreakoutViewState {
  if (isAdmin) return assignment ? 'host-occupant' : 'host';
  return assignment ? 'guest-occupant' : 'guest-idle';
}
