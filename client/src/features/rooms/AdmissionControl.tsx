import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  decideAdmission,
  getRoomAdmission,
  updateRoomAdmission,
  type AdmissionManagement,
} from '@/lib/api';
import { useTranslation } from '../translation/useTranslation';
import styles from './AdmissionControl.module.css';

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
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {t('Administrar ingresos')} <span aria-live="polite">({data?.requests.length ?? 0})</span>
      </button>
      {error && !open && <p role="alert">{t(error)}</p>}
      <dialog
        ref={dialog}
        className={styles.dialog}
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        aria-labelledby="admission-title"
      >
        <button type="button" className={styles.close} onClick={() => setOpen(false)}>
          {t('Cerrar')}
        </button>
        <h2 id="admission-title">{t('Administrar ingresos')}</h2>
        {!data && !error && <p role="status">{t('Cargando solicitudes…')}</p>}
        {error && (
          <p role="alert" className={styles.error}>
            {t(error)}
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void refresh();
          }}
        >
          {t('Actualizar solicitudes')}
        </button>
        {data && (
          <>
            <fieldset disabled={busy}>
              <legend>{t('Configuración de ingreso')}</legend>
              <label>
                <input
                  type="checkbox"
                  checked={data.waitingRoomEnabled}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setData({ ...data, waitingRoomEnabled: checked });
                    void mutate(() => updateRoomAdmission(code, { waitingRoomEnabled: checked }));
                  }}
                />
                {t('Activar sala de espera')}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={data.entryLocked}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setData({ ...data, entryLocked: checked });
                    void mutate(() => updateRoomAdmission(code, { entryLocked: checked }));
                  }}
                />
                {t('Bloquear nuevos ingresos')}
              </label>
            </fieldset>
            <p>
              {t(
                'Desactivar la espera admite las solicitudes pendientes cuando los ingresos están desbloqueados.',
              )}
            </p>
            <p>{t('Los cambios de ingreso no expulsan a quienes ya están dentro.')}</p>
            <h3>
              {t('Solicitudes pendientes')} ({data.requests.length})
            </h3>
            {!data.requests.length && <p>{t('No hay solicitudes pendientes')}</p>}
            <ul className={styles.requests}>
              {data.requests.map((request) => (
                <li key={request.id}>
                  <strong>{request.name}</strong>
                  <span>{t(request.registered ? 'Cuenta registrada' : 'Invitado')}</span>
                  <time dateTime={request.createdAt}>
                    {new Date(request.createdAt).toLocaleTimeString()}
                  </time>
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
          </>
        )}
      </dialog>
    </div>
  );
}
