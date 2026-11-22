'use client';

import { useTranslation } from '../translation/useTranslation';
import type { BreakoutAssignment } from '../chat/useRoomSocket';
import styles from './BreakoutBanner.module.css';

interface BreakoutBannerProps {
  assignment: BreakoutAssignment;
  onReturn: () => void;
  // Disponible para deshabilitar el botón mientras la solicitud HTTP de
  // retorno está en vuelo (returnFromBreakoutRoom en lib/breakouts.ts).
  returning?: boolean;
}

// Para el occupant de una mini sala (design.md, tabla de Cliente): etiqueta
// siempre visible, botón "Volver" solo si la política lo permite, y un
// texto explícito en vez del botón cuando no -- mitigación del riesgo
// "percibido como estar atrapado" (D8/leave-policy, design.md).
export function BreakoutBanner({ assignment, onReturn, returning = false }: BreakoutBannerProps) {
  const { t } = useTranslation();
  const canReturnFreely = assignment.leavePolicy === 'free_return';

  return (
    <div className={styles.banner} role="status">
      <span className={styles.label}>{assignment.label}</span>
      {canReturnFreely ? (
        <button
          type="button"
          className={styles.returnButton}
          onClick={onReturn}
          disabled={returning}
        >
          {t('Volver')}
        </button>
      ) : (
        <span className={styles.lockedNotice}>
          {t('El host te va a devolver a la sala principal.')}
        </span>
      )}
    </div>
  );
}
