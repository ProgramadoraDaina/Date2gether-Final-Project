import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getNextScheduleOccurrence } from '@/lib/api';
import { useTranslation } from '../translation/useTranslation';
import { NextOccurrence } from './NextOccurrence';
import type { useAdmissionRequest } from './useAdmissionRequest';
import styles from './WaitingRoom.module.css';

export function WaitingRoom({
  code,
  admission,
}: {
  code: string;
  admission: ReturnType<typeof useAdmissionRequest>;
}) {
  const { t } = useTranslation();
  const terminal = admission.status !== 'pending';
  const [nextOccurrenceAt, setNextOccurrenceAt] = useState<string | null>(null);

  // D6: informational only -- never gates admission, and the response has
  // no field that could carry the owner's timezone (public endpoint, same
  // as the rest of the waiting-room flow).
  useEffect(() => {
    getNextScheduleOccurrence(code)
      .then((result) => setNextOccurrenceAt(result.nextOccurrenceAt))
      .catch(() => setNextOccurrenceAt(null));
  }, [code]);
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
      <NextOccurrence nextOccurrenceAt={nextOccurrenceAt} />
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
