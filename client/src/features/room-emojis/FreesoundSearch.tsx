'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import { ApiError, searchFreesound, type FreesoundSound } from '@/lib/api';
import styles from './FreesoundSearch.module.css';

// Freesound limita la cuota diaria de la key: no buscar en cada tecla.
const SEARCH_DEBOUNCE_MS = 500;

interface FreesoundSearchProps {
  code: string;
  selected: FreesoundSound | null;
  onSelect: (sound: FreesoundSound) => void;
}

function licenseLabel(url: string): string {
  if (/publicdomain\/zero/.test(url)) return 'CC0';
  const match = /licenses\/([a-z-]+)\/(\d+(?:\.\d+)?)/.exec(url);
  return match ? `CC ${match[1].toUpperCase()} ${match[2]}` : 'CC';
}

export function FreesoundSearch({ code, selected, onSelect }: FreesoundSearchProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FreesoundSound[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const sounds = await searchFreesound(code, trimmed);
        if (!cancelled) setResults(sounds);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los sonidos');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, query]);

  useEffect(() => () => previewRef.current?.pause(), []);

  function preview(sound: FreesoundSound) {
    previewRef.current?.pause();
    previewRef.current = new Audio(sound.previewUrl);
    void previewRef.current.play().catch(() => undefined);
  }

  return (
    <div className={styles.wrap}>
      <input
        className={styles.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('Buscar en Freesound (ej: bruh, airhorn)')}
        aria-label={t('Buscar sonido en Freesound')}
        maxLength={50}
      />
      <div className={styles.results} aria-busy={loading}>
        {error && (
          <p className={styles.status} role="alert">
            {t(error)}
          </p>
        )}
        {!error && loading && <p className={styles.status}>{t('Buscando…')}</p>}
        {!error && !loading && query.trim().length >= 2 && results.length === 0 && (
          <p className={styles.status}>{t('No se encontraron sonidos de hasta 5 segundos')}</p>
        )}
        <ul className={styles.list}>
          {results.map((sound) => (
            <li
              key={sound.id}
              className={styles.item}
              data-selected={selected?.id === sound.id}
            >
              <button
                type="button"
                className={styles.play}
                onClick={() => preview(sound)}
                aria-label={`${t('Escuchar')} ${sound.name}`}
              >
                ▶
              </button>
              <span className={styles.info}>
                <span className={styles.name} title={sound.name}>
                  {sound.name}
                </span>
                <span className={styles.meta}>
                  {sound.username} · {licenseLabel(sound.license)} · {sound.duration.toFixed(1)}s
                </span>
              </span>
              <button
                type="button"
                className={styles.use}
                onClick={() => onSelect(sound)}
                aria-pressed={selected?.id === sound.id}
              >
                {selected?.id === sound.id ? t('Elegido') : t('Usar')}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className={styles.attribution}>Sounds from Freesound.org</p>
    </div>
  );
}
