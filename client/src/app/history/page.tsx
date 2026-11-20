'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ApiError,
  clearCallHistoryArchive,
  getCallHistory,
  getRoomCallArchive,
  type CallHistoryPage,
} from '@/lib/api';
import { isLoggedIn } from '@/lib/auth';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import styles from './page.module.css';

// useSearchParams needs a Suspense boundary or the static build of /history fails.
export default function HistoryPage() {
  return (
    <Suspense fallback={null}>
      <HistoryContent />
    </Suspense>
  );
}

function HistoryContent() {
  const { t } = useTranslation();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const onLoggedOut = useCallback(() => setLoggedIn(false), []);
  const search = useSearchParams();
  const roomFilter = search.get('roomId');
  const roomArchive = roomFilter && search.get('roomArchive') === '1' ? roomFilter : null;

  useEffect(() => {
    setLoggedIn(isLoggedIn());
  }, []);

  if (loggedIn === null) return null;

  if (!loggedIn) {
    return (
      <AppShell>
        <div className={styles.card}>
          <h1>{t('Historial')}</h1>
          <p>{t('Necesitás iniciar sesión para ver tu historial de llamadas.')}</p>
          <p className={styles.authLinks}>
            <Link href="/login">{t('Iniciar sesión')}</Link>
            <Link href="/register">{t('Crear cuenta')}</Link>
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <HistoryList
        key={roomArchive ? `archive/${roomArchive}` : roomFilter}
        roomId={roomFilter}
        roomArchive={roomArchive}
        onLoggedOut={onLoggedOut}
      />
    </AppShell>
  );
}

function HistoryList({
  roomId,
  roomArchive,
  onLoggedOut,
}: {
  roomId: string | null;
  roomArchive: string | null;
  onLoggedOut: () => void;
}) {
  const { t, language } = useTranslation();
  const [view, setView] = useState<'recent' | 'archive'>('recent');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [response, setResponse] = useState<{
    key: string;
    page?: CallHistoryPage;
    error?: string;
  } | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const before = cursors.at(-1) ?? null;
  const archive = view === 'archive' || !!roomArchive;
  const requestKey = `${view}/${before ?? ''}/${deleted}`;
  const current = response?.key === requestKey ? response : null;
  const page = current?.page;
  const error = current?.error;
  const loading = current === null;

  useEffect(() => {
    const controller = new AbortController();
    const load = roomArchive
      ? getRoomCallArchive(roomArchive, before, controller.signal)
      : getCallHistory(view, roomId, before, controller.signal);
    load
      .then((result) => {
        if (!controller.signal.aborted) setResponse({ key: requestKey, page: result });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setResponse({
          key: requestKey,
          error: err instanceof ApiError ? err.message : 'No se pudo obtener el historial',
        });
        if (!isLoggedIn()) onLoggedOut();
      });
    return () => controller.abort();
  }, [view, roomId, roomArchive, before, requestKey, onLoggedOut]);

  function showView(next: 'recent' | 'archive') {
    setView(next);
    setCursors([null]);
    setShowDelete(false);
    setDeleteError(null);
    setDeleted(false);
  }

  async function deleteArchive() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await clearCallHistoryArchive();
      showView('recent');
      setDeleted(true);
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : 'No se pudo borrar el historial anterior',
      );
      if (!isLoggedIn()) onLoggedOut();
    } finally {
      setDeleting(false);
    }
  }

  const entries = page?.entries ?? [];
  const filteredRoomName = entries[0]?.roomName;
  const dateFormat = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className={styles.card}>
      <h1>
        {t(
          roomArchive
            ? 'Archivo de llamadas de la sala'
            : archive
              ? 'Historial conservado'
              : 'Historial',
        )}
      </h1>
      {roomArchive && (
        <Link href={`/history?roomId=${encodeURIComponent(roomArchive)}`}>
          {t('Ver historial de la sala')}
        </Link>
      )}
      {!archive && <p className={styles.filter}>{t('Llamadas de los últimos 90 días')}</p>}
      {loading && <p>{t('Cargando historial…')}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {t(error)}
        </p>
      )}

      {roomId && !loading && !error && (
        <p className={styles.filter}>
          {filteredRoomName
            ? `${t('Mostrando solo las llamadas de')} ${filteredRoomName}.`
            : t(
                archive
                  ? 'Esta sala no tiene llamadas conservadas.'
                  : 'Esta sala no tiene llamadas recientes.',
              )}{' '}
          <Link href="/history">{t('Ver todo el historial')}</Link>
        </p>
      )}

      {!roomId && !loading && !error && entries.length === 0 && (
        <p>
          {t(archive ? 'No hay llamadas conservadas.' : 'No hay llamadas en los últimos 90 días.')}
        </p>
      )}

      {!loading && entries.length > 0 && (
        <ul className={styles.list}>
          {entries.map((entry) => (
            <li key={entry.id} className={styles.entry}>
              <div className={styles.entryMain}>
                <strong>{entry.roomName}</strong>
                <span className={styles.code}>{entry.roomCode}</span>
              </div>
              <div className={styles.entryMeta}>
                <span className={styles.date}>{dateFormat.format(new Date(entry.startedAt))}</span>
                {/* Sin sessionId: el intento nunca llegó a materializarse
                      en una sesión (falló, o nadie llegó a conectar del
                      todo) — la fila sigue ahí para no perder de cuál
                      llamada era, simplemente sin botón al gráfico. */}
                {entry.sessionId && (
                  <Link href={`/history/${entry.sessionId}`} className={styles.sessionLink}>
                    {t('Ver gráfico de interacción')}
                  </Link>
                )}
                {entry.sessionId && (
                  <Link
                    href={`/history/${entry.sessionId}#transcript`}
                    className={styles.sessionLink}
                  >
                    {t('Ver transcripción')}
                  </Link>
                )}
                {/* Las notas son por sala, no por sesión: a diferencia del
                      gráfico de arriba, este botón sale siempre. La ruta
                      identifica la sala por roomId (D4-C: el code puede
                      haber sido reciclado a otra sala desde esta llamada);
                      roomCode viaja como query param, solo para la clave
                      de notas personales de este dispositivo. */}
                {!roomArchive && (
                  <Link
                    href={`/history/notes/${entry.roomId}?code=${encodeURIComponent(entry.roomCode)}`}
                    className={styles.sessionLink}
                  >
                    {t('Obtener notas')}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!loading && (cursors.length > 1 || page?.nextCursor) && (
        <div className={styles.actions}>
          {cursors.length > 1 && (
            <button
              type="button"
              className={styles.sessionLink}
              disabled={deleting}
              onClick={() => setCursors(cursors.slice(0, -1))}
            >
              {t('Página anterior')}
            </button>
          )}
          {page?.nextCursor && (
            <button
              type="button"
              className={styles.sessionLink}
              disabled={deleting}
              onClick={() => setCursors([...cursors, page.nextCursor])}
            >
              {t('Página siguiente')}
            </button>
          )}
        </div>
      )}
      {!roomArchive && (archive || page?.hasArchived) && (
        <div className={styles.archive}>
          <p>{t('Las llamadas de hace más de 90 días se guardan en el archivo de tu cuenta.')}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.sessionLink}
              disabled={deleting}
              onClick={() => showView(archive ? 'recent' : 'archive')}
            >
              {t(archive ? 'Volver a las llamadas recientes' : 'Conservar y ver el archivo')}
            </button>
            {!roomId && !showDelete && (page?.hasArchived || (archive && entries.length > 0)) && (
              <button
                type="button"
                className={styles.sessionLink}
                onClick={() => setShowDelete(true)}
              >
                {t('Borrar historial anterior')}
              </button>
            )}
          </div>
          {showDelete && (
            <div role="group" aria-labelledby="confirm-history-deletion">
              <p id="confirm-history-deletion">
                {t(
                  '¿Borrar de tu cuenta todas las llamadas de hace más de 90 días? Esta acción es permanente.',
                )}
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.sessionLink}
                  disabled={deleting}
                  onClick={() => setShowDelete(false)}
                >
                  {t('Cancelar')}
                </button>
                <button
                  type="button"
                  className={`${styles.sessionLink} ${styles.danger}`}
                  disabled={deleting}
                  onClick={() => void deleteArchive()}
                >
                  {t(deleting ? 'Borrando…' : 'Confirmar borrado')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {deleteError && (
        <p className={styles.error} role="alert">
          {t(deleteError)}
        </p>
      )}
      {deleted && <p role="status">{t('Se borró el historial anterior de tu cuenta.')}</p>}
    </div>
  );
}
