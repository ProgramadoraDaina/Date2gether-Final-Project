'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import { searchGifs, type Gif } from '@/lib/gifs';
import styles from './GifPickerButton.module.css';
import { useDismiss } from '@/lib/useDismiss';

// La key beta de GIPHY permite 100 búsquedas por hora: no buscar en cada tecla.
const SEARCH_DEBOUNCE_MS = 400;

interface GifPickerButtonProps {
  roomCode: string;
  roomToken: string;
  onSelect: (url: string) => void;
}

export function GifPickerButton({ roomCode, roomToken, onSelect }: GifPickerButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, wrapRef, close);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const page = await searchGifs(roomCode, roomToken, query.trim(), 0, controller.signal);
        setGifs(page.results);
        setNextOffset(page.nextOffset);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, roomCode, roomToken]);

  async function loadMore() {
    if (nextOffset === null || loading) return;
    setLoading(true);
    try {
      const page = await searchGifs(roomCode, roomToken, query.trim(), nextOffset);
      setGifs((prev) => [...prev, ...page.results]);
      setNextOffset(page.nextOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : null);
    } finally {
      setLoading(false);
    }
  }

  const label = t('Buscar GIF');

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        GIF
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label={label}>
          <input
            className={styles.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Buscar en GIPHY...')}
            aria-label={label}
            maxLength={50}
            autoFocus
          />
          <div className={styles.results} aria-busy={loading}>
            {error && (
              <p className={styles.status} role="alert">
                {t(error)}
              </p>
            )}
            {!error && !loading && gifs.length === 0 && (
              <p className={styles.status}>{t('No se encontraron GIFs')}</p>
            )}
            <div className={styles.grid}>
              {gifs.map((gif) => (
                <button
                  key={gif.id}
                  type="button"
                  className={styles.gif}
                  onClick={() => {
                    onSelect(gif.url);
                    setOpen(false);
                  }}
                  aria-label={gif.title || 'GIF'}
                >
                  <img src={gif.previewUrl} alt="" loading="lazy" />
                </button>
              ))}
            </div>
            {nextOffset !== null && gifs.length > 0 && (
              <button
                type="button"
                className={styles.loadMore}
                onClick={loadMore}
                disabled={loading}
              >
                {loading ? t('Cargando…') : t('Cargar más')}
              </button>
            )}
          </div>
          <p className={styles.attribution}>Powered by GIPHY</p>
        </div>
      )}
    </div>
  );
}
