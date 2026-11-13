'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, createRoom } from '@/lib/api';
import { getCurrentUser, isLoggedIn, logout, type AuthUser } from '@/lib/auth';
import { useLocalStorageValue } from '@/lib/useLocalStorageValue';
import { useSessionStatus } from '@/lib/useSessionStatus';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import styles from './page.module.css';

const NAME_KEY = 'date2gether:userName';

export default function HomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const storedName = useLocalStorageValue(NAME_KEY) ?? '';
  const [nameDraft, setName] = useState<string | null>(null);
  const name = nameDraft ?? storedName;
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const sessionStatus = useSessionStatus();
  const [checkingSession, setCheckingSession] = useState(true);
  const loggedIn = sessionStatus === true && (checkingSession || user !== null);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((currentUser) => {
        if (cancelled) return;
        setUser(currentUser);
        if (currentUser) {
          setName(currentUser.name);
          localStorage.setItem(NAME_KEY, currentUser.name);
        }
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!loggedIn) {
      setError(t('Necesitás iniciar sesión para crear una reunión.'));
      return;
    }
    localStorage.setItem(NAME_KEY, name.trim());
    setLoading(true);
    setError(null);
    try {
      const room = await createRoom(`Reunión de ${name.trim()}`);
      router.push(`/room/${encodeURIComponent(room.code)}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t('No se pudo crear la reunión. ¿Está corriendo el backend?'),
      );
      if (!isLoggedIn()) {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!joinCode.trim() || !name.trim()) return;
    localStorage.setItem(NAME_KEY, name.trim());
    router.push(`/room/${encodeURIComponent(joinCode.trim())}`);
  }

  return (
    <AppShell>
      <div className={styles.card}>
        <h1>Date2gether</h1>
        <p className={styles.subtitle} data-testid="subtitle">
          {t('Videollamadas simples, en el navegador.')}
        </p>

        {!checkingSession && (
          <div className={styles.authBar} data-testid="auth-bar">
            {loggedIn && user ? (
              <>
                <span>
                  {t('Conectado como')} <strong>{user.name}</strong>
                </span>
                <button type="button" className={styles.linkButton} onClick={handleLogout}>
                  {t('Cerrar sesión')}
                </button>
              </>
            ) : (
              <span>
                <Link href="/login">{t('Iniciar sesión')}</Link> ·{' '}
                <Link href="/register">{t('Crear cuenta')}</Link>
              </span>
            )}
          </div>
        )}

        <form onSubmit={handleCreate}>
          <label htmlFor="display-name">{t('Tu nombre')}</label>
          <input
            id="display-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('¿Cómo te llamás?')}
            maxLength={60}
            required
          />
          <button type="submit" disabled={loading || !loggedIn}>
            {loading ? t('Creando…') : t('Crear reunión')}
          </button>
          {!checkingSession && !loggedIn && (
            <p className={styles.hintBelowButton}>
              {t('Necesitás iniciar sesión (arriba) para crear una reunión.')}
            </p>
          )}
        </form>

        <div className={styles.divider}>{t('o unite a una existente')}</div>
        <p>{t('Podés entrar con un enlace o código sin crear una cuenta.')}</p>

        <form className={styles.joinRow} onSubmit={handleJoin}>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="abc-defg-hij"
          />
          <button type="submit" className="secondary">
            {t('Unirse')}
          </button>
        </form>

        {error && (
          <p className={styles.error} data-testid="error-message">
            {error}
          </p>
        )}
      </div>
    </AppShell>
  );
}
