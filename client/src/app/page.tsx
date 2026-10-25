'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createRoom } from '@/lib/api';
import { getCurrentUser, logout, type AuthUser } from '@/lib/auth';

const NAME_KEY = 'date2gether:userName';

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    setName(localStorage.getItem(NAME_KEY) ?? '');

    getCurrentUser()
      .then((currentUser) => {
        setUser(currentUser);
        if (currentUser) {
          setName(currentUser.name);
          localStorage.setItem(NAME_KEY, currentUser.name);
        }
      })
      .finally(() => setCheckingSession(false));
  }, []);

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!user) {
      router.push('/login');
      return;
    }
    localStorage.setItem(NAME_KEY, name.trim());
    setLoading(true);
    setError(null);
    try {
      const room = await createRoom(`Reunión de ${name.trim()}`);
      router.push(`/room/${encodeURIComponent(room.code)}`);
    } catch {
      setError('No se pudo crear la reunión. ¿Está corriendo el backend?');
    } finally {
      setLoading(false);
    }
  }

  function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!joinCode.trim() || !name.trim()) return;
    if (!user) {
      router.push('/login');
      return;
    }
    localStorage.setItem(NAME_KEY, name.trim());
    router.push(`/room/${encodeURIComponent(joinCode.trim())}`);
  }

  return (
    <div className="card">
      <h1>Date2gether</h1>
      <p className="subtitle">Videollamadas simples, en el navegador.</p>

      {!checkingSession && (
        <div className="auth-bar">
          {user ? (
            <>
              <span>
                Conectado como <strong>{user.name}</strong>
              </span>
              <button type="button" className="link-button" onClick={handleLogout}>
                Cerrar sesión
              </button>
            </>
          ) : (
            <span>
              <Link href="/login">Iniciar sesión</Link> · <Link href="/register">Crear cuenta</Link>
            </span>
          )}
        </div>
      )}

      <form onSubmit={handleCreate}>
        <label htmlFor="display-name">Tu nombre</label>
        <input
          id="display-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="¿Cómo te llamás?"
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Creando…' : 'Crear reunión'}
        </button>
      </form>

      <div className="divider">o unite a una existente</div>

      <form className="join-row" onSubmit={handleJoin}>
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="abc-defg-hij"
        />
        <button type="submit" className="secondary">
          Unirse
        </button>
      </form>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
