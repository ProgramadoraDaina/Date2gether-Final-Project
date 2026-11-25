import Link from 'next/link';
import { ThemeToggle } from '@/features/theme/ThemeToggle';
import { LanguageToggle } from '@/features/translation/LanguageToggle';
import { useEffect, useRef, useState } from 'react';
import { BrandMark } from '@/features/brand/BrandMark';
import { getNextScheduleOccurrence } from '@/lib/api';
import { useTranslation } from '../translation/useTranslation';
import { NextOccurrence } from './NextOccurrence';
import type { useAdmissionRequest } from './useAdmissionRequest';
import styles from './WaitingRoom.module.css';

const statusMessages = {
  pending: 'Esperando al anfitrión',
  rejected: 'El anfitrión rechazó tu solicitud.',
  cancelled: 'La solicitud fue cancelada.',
  expired: 'La solicitud venció. Podés volver a solicitar el ingreso.',
};

export function WaitingRoom({
  code,
  admission,
}: {
  code: string;
  admission: ReturnType<typeof useAdmissionRequest>;
}) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const terminal = admission.status !== 'pending';
  const waiting = !terminal && !admission.cancelIntent;
  const [schedule, setSchedule] = useState<{ code: string; nextOccurrenceAt: string | null }>();

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    let active = true;
    // El horario es informativo y no condiciona el ingreso.
    getNextScheduleOccurrence(code)
      .then(({ nextOccurrenceAt }) => {
        if (active) setSchedule({ code, nextOccurrenceAt });
      })
      .catch(() => {
        // Solo mostramos horarios confirmados por el servidor.
      });
    return () => {
      active = false;
    };
  }, [code]);

  const message = admission.cancelling
    ? 'Cancelando…'
    : admission.cancelIntent
      ? 'Cancelación pendiente'
      : statusMessages[admission.status];

  return (
    <section className={styles.card} aria-labelledby="waiting-title">
      <div className={styles.toggles}>
        <ThemeToggle />
        <LanguageToggle />
      </div>
      <div className={styles.panels}>
        <div className={styles.info}>
          <h1 id="waiting-title" className={styles.title} ref={titleRef} tabIndex={-1}>
            {t('Sala de espera')}
          </h1>

          <div className={styles.status}>
            <p className={styles.message} role="status">
              {t(message)}
            </p>
            {waiting && (
              <>
                <p className={styles.hint}>
                  {t('Vas a entrar automáticamente cuando te admitan.')}
                </p>
                <div
                  className={styles.progress}
                  role="progressbar"
                  aria-label={t('Esperando la admisión')}
                />
              </>
            )}
            {admission.error && (
              <p className={styles.error} role="alert">
                {t(admission.error)}
              </p>
            )}
          </div>

          {schedule?.code === code && (
            <NextOccurrence nextOccurrenceAt={schedule.nextOccurrenceAt} />
          )}

          <div className={styles.controls}>
            <div className={styles.actions}>
              {terminal ? (
                <button type="button" onClick={admission.reset}>
                  {t('Volver al formulario')}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.cancel}
                  disabled={admission.cancelling}
                  onClick={() => {
                    void admission.cancel();
                  }}
                >
                  {t(admission.cancelling ? 'Cancelando…' : 'Cancelar solicitud')}
                </button>
              )}
            </div>
            <Link
              className={styles.home}
              href="/"
              onClick={() => {
                if (!terminal) void admission.cancel();
              }}
            >
              {t('Volver al inicio')}
            </Link>
          </div>

          <p className={styles.privacy}>
            {t('Todavía no estás conectado al chat ni a la llamada.')}
          </p>
        </div>

        <div className={styles.identity}>
          <div className={styles.brand}>
            <BrandMark size={100} />
            <span>Date2Gether</span>
          </div>
          <dl className={styles.room}>
            <dt>{t('Código de la sala')}</dt>
            <dd>
              <code>{code}</code>
            </dd>
          </dl>
        </div>
      </div>
    </section>
  );
}
