'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, updateNameColor } from '@/lib/api';
import { getCurrentUser, isLoggedIn } from '@/lib/auth';
import { NAME_COLOR_HEX, NAME_COLOR_IDS, type NameColorId } from '@/lib/nameColors';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import styles from './page.module.css';

// Nombres legibles de cada id de color, solo para el aria-label/title de cada
// chip (la paleta en sí vive en '@/lib/nameColors', compartida con la sala).
const COLOR_LABELS: Record<NameColorId, string> = {
  purple: 'Púrpura',
  red: 'Rojo',
  teal: 'Verde azulado',
  amber: 'Ámbar',
  navy: 'Azul marino',
  orange: 'Naranja',
  green: 'Verde',
  pink: 'Rosa',
};

export default function SettingsPage() {
  const { t } = useTranslation();
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [selected, setSelected] = useState<NameColorId | null>(null);
  const [saving, setSaving] = useState<NameColorId | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      setChecking(false);
      return;
    }

    getCurrentUser()
      .then((user) => {
        setLoggedIn(user !== null);
        if (user?.nameColor && NAME_COLOR_IDS.includes(user.nameColor as NameColorId)) {
          setSelected(user.nameColor as NameColorId);
        }
      })
      .finally(() => setChecking(false));
  }, []);

  async function handleSelect(id: NameColorId) {
    if (saving) return;
    setSaving(id);
    setSaved(false);
    setError(null);
    try {
      await updateNameColor(id);
      setSelected(id);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('No se pudo guardar el color'));
    } finally {
      setSaving(null);
    }
  }

  if (checking) return null;

  if (!loggedIn) {
    return (
      <AppShell>
        <div className={styles.card}>
          <h1>{t('Configuración')}</h1>
          <p>{t('Necesitás iniciar sesión para elegir el color de tu nombre.')}</p>
          <p>
            <Link href="/login">{t('Iniciar sesión')}</Link> ·{' '}
            <Link href="/register">{t('Crear cuenta')}</Link>
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className={styles.card}>
        <h1>{t('Configuración')}</h1>
        <p className={styles.subtitle}>{t('Elegí el color de tu nombre')}</p>

        <div className={styles.palette} role="group" aria-label={t('Elegí el color de tu nombre')}>
          {NAME_COLOR_IDS.map((id) => {
            const label = t(COLOR_LABELS[id]);
            const isSelected = selected === id;
            return (
              <button
                key={id}
                type="button"
                className={`${styles.swatch} ${isSelected ? styles.swatchSelected : ''}`}
                style={{ backgroundColor: NAME_COLOR_HEX[id] }}
                onClick={() => handleSelect(id)}
                disabled={saving !== null}
                aria-pressed={isSelected}
                aria-label={label}
                title={label}
              >
                {isSelected && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                    <path d="M4 12l6 6L20 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>

        {saved && !error && <p className={styles.saved}>{t('Guardado')}</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </AppShell>
  );
}
