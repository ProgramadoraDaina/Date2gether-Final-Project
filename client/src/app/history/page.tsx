'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ApiError,
  clearCallHistoryArchive,
  getCallHistory,
  getOwnedRooms,
  getRoomCallArchive,
  type CallHistoryEntry,
  type CallHistoryPage,
  type OwnedRoom,
} from '@/lib/api';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import styles from './page.module.css';
import { EmptyState } from '@/features/layout/EmptyState';
import { SkeletonList } from '@/features/layout/SkeletonList';

// useSearchParams needs a Suspense boundary or the static build of /history fails.
export default function HistoryPage() {
  return (
    <Suspense fallback={null}>
      <RequireAuth>
        <HistoryContent />
      </RequireAuth>
    </Suspense>
  );
}

function HistoryContent() {
  const search = useSearchParams();
  const roomFilter = search.get('roomId');
  const roomArchive = roomFilter && search.get('roomArchive') === '1' ? roomFilter : null;

  return (
    <AppShell>
      <HistoryList
        key={roomArchive ? `archive/${roomArchive}` : roomFilter}
        roomId={roomFilter}
        roomArchive={roomArchive}
      />
    </AppShell>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// Agrupa por día local manteniendo el orden en que llegan las llamadas.
function groupByDay(entries: CallHistoryEntry[]): [string, CallHistoryEntry[]][] {
  const groups = new Map<string, CallHistoryEntry[]>();
  for (const entry of entries) {
    const key = dayKey(new Date(entry.startedAt));
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.entries()];
}

function Tabs({
  recentActive,
  onRecent,
  onOlder,
}: {
  recentActive: boolean;
  onRecent: () => void;
  onOlder: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.tabs} role="group" aria-label={t('Período')}>
      <button type="button" className={styles.tab} aria-pressed={recentActive} onClick={onRecent}>
        {t('Últimos 90 días')}
      </button>
      <button type="button" className={styles.tab} aria-pressed={!recentActive} onClick={onOlder}>
        {t('Más antiguas')}
      </button>
    </div>
  );
}

function HistoryList({
  roomId,
  roomArchive,
}: {
  roomId: string | null;
  roomArchive: string | null;
}) {
  const { t, language } = useTranslation();
  const locale = language === 'en' ? 'en-US' : 'es-AR';
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
      });
    return () => controller.abort();
  }, [view, roomId, roomArchive, before, requestKey]);

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
    } finally {
      setDeleting(false);
    }
  }

  const entries = page?.entries ?? [];
  const filteredRoomName = entries[0]?.roomName;
  const timeFormat = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: language === 'en' ? 'h12' : 'h23',
  });
  const dayFormat = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - DAY_MS));

  function dayLabel(sample: string): string {
    const date = new Date(sample);
    const key = dayKey(date);
    if (key === today) return t('Hoy');
    if (key === yesterday) return t('Ayer');
    return dayFormat.format(date);
  }

  const roomScoped = !!roomId;
  const showTabs = !roomArchive && (roomScoped || archive || !!page?.hasArchived);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {roomArchive ? (
          <Link href={`/history?roomId=${encodeURIComponent(roomArchive)}`} className={styles.back}>
            <span aria-hidden="true">← </span>
            {t('Ver mis llamadas en esta sala')}
          </Link>
        ) : (
          roomScoped && (
            <Link href="/history" className={styles.back}>
              <span aria-hidden="true">← </span>
              {t('Ver todo el historial')}
            </Link>
          )
        )}
        <h1>
          {roomArchive
            ? t('Archivo compartido de la sala')
            : roomScoped
              ? filteredRoomName
                ? `${t('Llamadas de')} ${filteredRoomName}`
                : t('Llamadas de la sala')
              : t('Historial')}
        </h1>
        <p>
          {t(
            roomArchive
              ? 'Llamadas de hace más de 90 días de todas las personas que usaron esta sala. Solo lo ven quienes la administran.'
              : archive
                ? 'Tus llamadas de hace más de 90 días.'
                : 'Tus llamadas de los últimos 90 días.',
          )}
        </p>
      </header>

      {!roomScoped && <OwnedRoomsSection />}

      <section className={styles.callsSection} aria-labelledby="calls-title">
        <div className={styles.sectionHead}>
          <h2 id="calls-title" className={styles.sectionTitle}>
            {t('Llamadas')}
          </h2>
          {showTabs && (
            <Tabs
              recentActive={!archive}
              onRecent={() => showView('recent')}
              onOlder={() => showView('archive')}
            />
          )}
        </div>

        {loading && <SkeletonList label={t('Cargando historial…')} />}
        {error && (
          <p className={styles.error} role="alert">
            {t(error)}
          </p>
        )}

        {!loading && !error && entries.length === 0 && (
          <EmptyState
            title={t(
              roomScoped
                ? archive
                  ? 'Esta sala no tiene llamadas conservadas.'
                  : 'Esta sala no tiene llamadas recientes.'
                : archive
                  ? 'No hay llamadas conservadas.'
                  : 'No hay llamadas en los últimos 90 días.',
            )}
            hint={
              roomScoped ? undefined : t('Las llamadas en las que participes van a aparecer acá.')
            }
          />
        )}

        {!loading &&
          groupByDay(entries).map(([key, dayEntries]) => (
            <div key={key} className={styles.day}>
              <h3 className={styles.dayTitle}>{dayLabel(dayEntries[0].startedAt)}</h3>
              <ul className={styles.list}>
                {dayEntries.map((entry) => (
                  <li key={entry.id} className={styles.call}>
                    <time className={styles.time} dateTime={entry.startedAt}>
                      {timeFormat.format(new Date(entry.startedAt))}
                    </time>
                    <div className={styles.callMain}>
                      <strong>{entry.roomName}</strong>
                      <span className={styles.code}>{entry.roomCode}</span>
                    </div>
                    <div className={styles.callActions}>
                      {/* Sin sessionId nadie llegó a conectarse: no hay gráfico ni transcripción. */}
                      {entry.sessionId ? (
                        <>
                          <Link
                            href={`/history/${entry.sessionId}`}
                            className={styles.action}
                            aria-label={t('Ver gráfico de interacción')}
                          >
                            {t('Gráfico')}
                          </Link>
                          <Link
                            href={`/history/${entry.sessionId}#transcript`}
                            className={styles.action}
                            aria-label={t('Ver transcripción')}
                          >
                            {t('Transcripción')}
                          </Link>
                        </>
                      ) : (
                        <span className={styles.noSession}>{t('Nadie llegó a conectarse')}</span>
                      )}
                      {/* Las notas son de la sala (por roomId); el code solo arma la clave local. */}
                      {!roomArchive && (
                        <Link
                          href={`/history/notes/${entry.roomId}?code=${encodeURIComponent(entry.roomCode)}`}
                          className={styles.action}
                          aria-label={t('Obtener notas')}
                        >
                          {t('Notas')}
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}

        {!loading && (cursors.length > 1 || page?.nextCursor) && (
          <div className={styles.pager}>
            {cursors.length > 1 && (
              <button
                type="button"
                className="secondary"
                disabled={deleting}
                onClick={() => setCursors(cursors.slice(0, -1))}
              >
                {t('Página anterior')}
              </button>
            )}
            {page?.nextCursor && (
              <button
                type="button"
                className="secondary"
                disabled={deleting}
                onClick={() => setCursors([...cursors, page.nextCursor])}
              >
                {t('Página siguiente')}
              </button>
            )}
          </div>
        )}
      </section>

      {!roomScoped && archive && entries.length > 0 && (
        <section className={styles.dangerZone} aria-labelledby="delete-archive-title">
          <div>
            <h2 id="delete-archive-title" className={styles.sectionTitle}>
              {t('Borrar llamadas antiguas')}
            </h2>
            <p>
              {t(
                'Quita de tu cuenta las llamadas de hace más de 90 días. A los demás participantes no les cambia nada.',
              )}
            </p>
          </div>
          {!showDelete ? (
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => setShowDelete(true)}
            >
              {t('Borrar historial anterior')}
            </button>
          ) : (
            <div role="group" aria-labelledby="confirm-history-deletion">
              <p id="confirm-history-deletion">
                {t(
                  '¿Borrar de tu cuenta todas las llamadas de hace más de 90 días? Esta acción es permanente.',
                )}
              </p>
              <div className={styles.pager}>
                <button
                  type="button"
                  className="secondary"
                  disabled={deleting}
                  onClick={() => setShowDelete(false)}
                >
                  {t('Cancelar')}
                </button>
                <button
                  type="button"
                  className={styles.dangerButton}
                  disabled={deleting}
                  aria-busy={deleting}
                  onClick={() => void deleteArchive()}
                >
                  {t(deleting ? 'Borrando…' : 'Confirmar borrado')}
                </button>
              </div>
            </div>
          )}
        </section>
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

function OwnedRoomsSection() {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<OwnedRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Corre solo al montar: `t` se omite a propósito para no repetir el fetch al cambiar el idioma.
  useEffect(() => {
    getOwnedRooms()
      .then(setRooms)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t('No se pudieron cargar tus salas'));
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <section aria-label={t('Salas que administrás')} className={styles.roomsSection}>
      <h2 className={styles.sectionTitle}>{t('Salas que administrás')}</h2>
      {loading && <SkeletonList label={t('Cargando salas…')} rows={2} />}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!loading && !error && rooms.length === 0 && (
        <EmptyState title={t('Todavía no tenés salas como administrador.')} />
      )}
      {rooms.length > 0 && (
        <ul className={styles.rooms}>
          {rooms.map((room) => (
            <li key={room.id} className={styles.room}>
              <div className={styles.roomText}>
                <strong>{room.name}</strong>
                <span className={styles.code}>{room.code}</span>
              </div>
              <div className={styles.roomActions}>
                {room.isJoinable ? (
                  <Link href={`/room/${room.code}`} className={styles.enter}>
                    {t('Entrar')}
                  </Link>
                ) : (
                  <span className={styles.expired}>{t('Vencida')}</span>
                )}
                <Link
                  href={`/history?roomId=${encodeURIComponent(room.id)}`}
                  className={styles.action}
                >
                  {t('Sus llamadas')}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
