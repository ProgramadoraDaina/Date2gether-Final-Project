import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  decideAdmission,
  getRoomAdmission,
  updateRoomAdmission,
  type AdmissionManagement,
} from '@/lib/api';
import { useTranslation } from '../translation/useTranslation';
import { AdmissionToasts } from './AdmissionToasts';
import styles from './AdmissionControl.module.css';

const ADMISSION_HELP =
  'Aceptá o rechazá a quienes piden entrar y elegí cómo se ingresa a la sala. Las solicitudes se actualizan solas.';

function InfoTip({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className={styles.infoTip}>
      <button type="button" className={styles.infoIcon} aria-label={label} aria-describedby={id}>
        i
      </button>
      <span id={id} role="tooltip" className={styles.tooltip}>
        {children}
      </span>
    </span>
  );
}

export function AdmissionControl({ code }: { code: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<AdmissionManagement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const mutating = useRef(false);
  const lifecycle = useRef<AbortController | null>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const current = ++sequence.current;
      try {
        const latest = await getRoomAdmission(code, signal);
        if (mounted.current && current === sequence.current && !signal?.aborted) {
          setData(latest);
          setError(null);
        }
      } catch (cause) {
        if (mounted.current && current === sequence.current && !signal?.aborted)
          setError(
            cause instanceof ApiError ? cause.message : 'No se pudieron cargar las solicitudes',
          );
      }
    },
    [code],
  );

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    lifecycle.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!mutating.current) await refresh(controller.signal);
      if (!controller.signal.aborted)
        timer = setTimeout(() => {
          void poll();
        }, 3000);
    }
    void poll();
    return () => {
      mounted.current = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  async function mutate(action: () => Promise<unknown>) {
    if (mutating.current) return;
    mutating.current = true;
    const scope = lifecycle.current;
    sequence.current++;
    setBusy(true);
    setError(null);
    try {
      await action();
      if (!scope?.signal.aborted) await refresh(scope?.signal);
    } catch (cause) {
      if (scope?.signal.aborted) return;
      await refresh(scope?.signal);
      if (mounted.current)
        setError(cause instanceof ApiError ? cause.message : 'No se pudo actualizar la admisión');
    } finally {
      mutating.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className={styles.control}>
      <button
        type="button"
        aria-haspopup="dialog"
        title={t(ADMISSION_HELP)}
        onClick={() => setOpen(true)}
      >
        {t('Administrar ingresos')} <span aria-live="polite">({data?.requests.length ?? 0})</span>
      </button>
      {!open && (
        <AdmissionToasts
          requests={data?.requests ?? []}
          busy={busy}
          onDecide={(requestId, decision) =>
            void mutate(() => decideAdmission(code, requestId, decision))
          }
          onOpenAll={() => setOpen(true)}
        />
      )}
      {error && !open && <p role="alert">{t(error)}</p>}
      <dialog
        ref={dialog}
        className={styles.dialog}
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        aria-labelledby="admission-title"
      >
        <header className={styles.header}>
          <h2 id="admission-title">{t('Administrar ingresos')}</h2>
          <button type="button" className={styles.close} onClick={() => setOpen(false)}>
            {t('Cerrar')}
          </button>
        </header>
        <p className={styles.help}>{t(ADMISSION_HELP)}</p>
        {!data && !error && <p role="status">{t('Cargando solicitudes…')}</p>}
        {error && (
          <p role="alert" className={styles.error}>
            {t(error)}
          </p>
        )}
        {data && (
          <>
            <fieldset disabled={busy} className={styles.section}>
              <legend className={styles.sectionTitle}>{t('Configuración de ingreso')}</legend>
              {data.isPermanent ? (
                <p className={styles.note}>
                  {t('Esta sala es permanente: la sala de espera está siempre activa.')}
                </p>
              ) : (
                <div className={styles.option}>
                  <label>
                    <input
                      type="checkbox"
                      checked={data.waitingRoomEnabled}
                      aria-describedby="admission-waiting-hint"
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setData({ ...data, waitingRoomEnabled: checked });
                        void mutate(() =>
                          updateRoomAdmission(code, { waitingRoomEnabled: checked }),
                        );
                      }}
                    />
                    {t('Activar sala de espera')}
                  </label>
                  <InfoTip id="admission-waiting-hint" label={t('Más información')}>
                    {t(
                      'Desactivar la espera admite las solicitudes pendientes cuando los ingresos están desbloqueados.',
                    )}
                  </InfoTip>
                </div>
              )}
              <div className={styles.option}>
                <label>
                  <input
                    type="checkbox"
                    checked={data.entryLocked}
                    aria-describedby="admission-lock-hint"
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setData({ ...data, entryLocked: checked });
                      void mutate(() => updateRoomAdmission(code, { entryLocked: checked }));
                    }}
                  />
                  {t('Bloquear nuevos ingresos')}
                </label>
                <InfoTip id="admission-lock-hint" label={t('Más información')}>
                  {t('Los cambios de ingreso no expulsan a quienes ya están dentro.')}
                </InfoTip>
              </div>
            </fieldset>
            <section className={styles.section} aria-labelledby="admission-requests-title">
              <h3 id="admission-requests-title" className={styles.sectionTitle}>
                {t('Solicitudes pendientes')}{' '}
                <span className={styles.count}>{data.requests.length}</span>
              </h3>
              {!data.requests.length && (
                <p className={styles.empty}>{t('No hay solicitudes pendientes')}</p>
              )}
              <ul className={styles.requests}>
                {data.requests.map((request) => (
                  <li key={request.id}>
                    <strong>{request.name}</strong>
                    <span>{t(request.registered ? 'Cuenta registrada' : 'Invitado')}</span>
                    <time dateTime={request.createdAt}>
                      {new Date(request.createdAt).toLocaleTimeString()}
                    </time>
                    {request.stale && (
                      <span className={styles.stale}>{t('Esperando hace más de 24h')}</span>
                    )}
                    <div className={styles.actions}>
                      <button
                        type="button"
                        disabled={busy || data.entryLocked}
                        aria-label={t('Admitir') + ' ' + request.name}
                        onClick={() => {
                          void mutate(() => decideAdmission(code, request.id, 'admitted'));
                        }}
                      >
                        {t('Admitir')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={t('Rechazar') + ' ' + request.name}
                        onClick={() => {
                          void mutate(() => decideAdmission(code, request.id, 'rejected'));
                        }}
                      >
                        {t('Rechazar')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </dialog>
    </div>
  );
}
