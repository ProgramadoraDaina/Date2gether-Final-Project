import Link from 'next/link';
import { useTranslation } from '../translation/useTranslation';
import type { useAdmissionRequest } from './useAdmissionRequest';
import styles from './WaitingRoom.module.css';

export function WaitingRoom({ admission }: { admission: ReturnType<typeof useAdmissionRequest> }) {
  const { t } = useTranslation();
  const terminal = admission.status !== 'pending';
  const message = {
    pending: 'El anfitrión debe admitir tu ingreso.',
    rejected: 'El anfitrión rechazó tu solicitud.',
    cancelled: 'La solicitud fue cancelada.',
    expired: 'La solicitud venció. Podés volver a solicitar el ingreso.',
  }[admission.status];
  return (
    <section className={styles.card} aria-labelledby="waiting-title">
      <h1 id="waiting-title">{t('Sala de espera')}</h1>
      <p role="status">{t(message)}</p>
      <p>{t('Todavía no estás conectado al chat ni a la llamada.')}</p>
      {admission.error && (
        <p className={styles.error} role="alert">
          {t(admission.error)}
        </p>
      )}
      {terminal ? (
        <button type="button" onClick={admission.reset}>
          {t('Volver al formulario')}
        </button>
      ) : (
        <>
          {!admission.cancelIntent && (
            <button type="button" onClick={admission.retry}>
              {t('Revisar estado')}
            </button>
          )}
          <button
            type="button"
            disabled={admission.cancelling}
            onClick={() => {
              void admission.cancel();
            }}
          >
            {t(admission.cancelling ? 'Cancelando…' : 'Cancelar solicitud')}
          </button>
        </>
      )}
      <Link
        href="/"
        onClick={() => {
          if (!terminal) void admission.cancel();
        }}
      >
        {t('Volver al inicio')}
      </Link>
    </section>
  );
}
