'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, createRoom } from '@/lib/api';
import { getCurrentUser, isLoggedIn, logout, onAuthChange, type AuthUser } from '@/lib/auth';
import { useTranslation } from '@/features/translation/useTranslation';

const NAME_KEY = 'date2gether:userName';

export default function HomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  // Arranca en false en server y cliente para no romper la hidratación.
  const [loggedIn, setLoggedIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    setName(localStorage.getItem(NAME_KEY) ?? '');
    // Leer el token es síncrono: no hace falta esperar a /auth/me para habilitar el botón.
    setLoggedIn(isLoggedIn());

    getCurrentUser()
      .then((currentUser) => {
        setUser(currentUser);
        setLoggedIn(currentUser !== null);
        if (currentUser) {
          setName(currentUser.name);
          localStorage.setItem(NAME_KEY, currentUser.name);
        }
      })
      .finally(() => setCheckingSession(false));

    return onAuthChange(() => {
      const stillLoggedIn = isLoggedIn();
      setLoggedIn(stillLoggedIn);
      if (!stillLoggedIn) setUser(null);
    });
  }, []);

  async function handleLogout() {
    await logout();
    setUser(null);
    setLoggedIn(false);
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
        setLoggedIn(false);
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!joinCode.trim() || !name.trim()) return;
    if (!loggedIn) {
      router.push('/login');
      return;
    }
    localStorage.setItem(NAME_KEY, name.trim());
    router.push(`/room/${encodeURIComponent(joinCode.trim())}`);
  }

  return (
    <div className="card">
      <h1>Date2gether</h1>
      <p className="subtitle">{t('Videollamadas simples, en el navegador.')}</p>

      {!checkingSession && (
        <div className="auth-bar">
          {user ? (
            <>
              <span>
                {t('Conectado como')} <strong>{user.name}</strong>
              </span>
              <button type="button" className="link-button" onClick={handleLogout}>
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
          required
        />
        <button type="submit" disabled={loading || !loggedIn}>
          {loading ? t('Creando…') : t('Crear reunión')}
        </button>
        {!checkingSession && !loggedIn && (
          <p className="hint-below-button">
            {t('Necesitás iniciar sesión (arriba) para crear una reunión.')}
          </p>
        )}
      </form>

      <div className="divider">{t('o unite a una existente')}</div>

      <form className="join-row" onSubmit={handleJoin}>
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="abc-defg-hij"
        />
        <button type="submit" className="secondary">
          {t('Unirse')}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
