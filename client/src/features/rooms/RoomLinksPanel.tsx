'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Socket } from 'socket.io-client';
import { useTranslation } from '@/features/translation/useTranslation';
import { addRoomLink, ApiError, deleteRoomLink, getRoomLinks, type RoomLink } from '@/lib/api';
import styles from './RoomLinksPanel.module.css';

interface RoomLinksPanelProps {
  code: string;
  token: string;
  socket: Socket | null;
  canManage: boolean;
}

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

export function RoomLinksPanel({ code, token, socket, canManage }: RoomLinksPanelProps) {
  const { t } = useTranslation();
  const [links, setLinks] = useState<RoomLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setLinks(await getRoomLinks(code, token));
    } catch (err) {
      setError(errorText(err, 'No se pudieron cargar los links'));
    }
  }, [code, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!socket) return;
    const onChanged = () => void reload();
    socket.on('roomLinksChanged', onChanged);
    return () => {
      socket.off('roomLinksChanged', onChanged);
    };
  }, [socket, reload]);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      setError(errorText(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const added = await run(
      () => addRoomLink(code, { url: url.trim(), title: title.trim() || undefined }),
      'No se pudo guardar el link',
    );
    if (added) {
      setUrl('');
      setTitle('');
    }
  }

  return (
    <section className={styles.panel} aria-label={t('Biblioteca de links')}>
      {canManage && (
        <form className={styles.form} onSubmit={handleAdd}>
          <label className={styles.field}>
            <span>{t('URL')}</span>
            <input
              type="url"
              required
              maxLength={2048}
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>{t('Título (opcional)')}</span>
            <input maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            {t('Guardar link')}
          </button>
        </form>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {t(error)}
        </p>
      )}
      {links?.length === 0 && <p className={styles.empty}>{t('Todavía no hay links guardados')}</p>}
      {links && links.length > 0 && (
        <ul className={styles.list}>
          {links.map((link) => (
            <li key={link.id} className={styles.item}>
              <a href={link.url} target="_blank" rel="noopener noreferrer" className={styles.link}>
                {link.title ?? link.url}
              </a>
              <span className={styles.meta}>
                {link.addedByName} · {new Date(link.createdAt).toLocaleDateString()}
              </span>
              {canManage && (
                <button
                  type="button"
                  className={`secondary ${styles.remove}`}
                  disabled={busy}
                  onClick={() =>
                    void run(() => deleteRoomLink(code, link.id), 'No se pudo quitar el link')
                  }
                >
                  {t('Quitar')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
