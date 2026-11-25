'use client';

import { BrandMark } from '@/features/brand/BrandMark';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, createRoom, type CreateScheduleSlot } from '@/lib/api';
import { getCurrentUser, isLoggedIn, logout, onAuthChange, type AuthUser } from '@/lib/auth';
import { useTranslation } from '@/features/translation/useTranslation';
import { loginUrlFor } from '@/features/auth/safeRedirect';
import { AppShell } from '@/features/navigation/AppShell';
import { ScheduleSlotEditor } from '@/features/rooms/ScheduleSlotEditor';
import styles from './page.module.css';

const NAME_KEY = 'date2gether:userName';

export default function HomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [isPermanent, setIsPermanent] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [slots, setSlots] = useState<CreateScheduleSlot[]>([]);
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
    // replace: the logged-out home must not stay in history either.
    router.replace('/login');
  }

  // push (not replace) so the back button returns to the home page.
  function redirectToLogin() {
    router.push(loginUrlFor('/'));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!loggedIn) {
      redirectToLogin();
      return;
    }
    if (!name.trim()) return;
    localStorage.setItem(NAME_KEY, name.trim());
    setLoading(true);
    setError(null);
    try {
      // Las temporales se recuperan en 24h (D5): no tiene sentido pedirles un
      // nombre propio, se quedan con el autogenerado de siempre.
      const roomTitle =
        isPermanent && roomName.trim() ? roomName.trim() : `Reunión de ${name.trim()}`;
      const room = await createRoom(roomTitle, {
        isPermanent,
        slots: isPermanent ? slots : undefined,
      });
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
    localStorage.setItem(NAME_KEY, name.trim());
    router.push(`/room/${encodeURIComponent(joinCode.trim())}`);
  }

  return (
    <AppShell>
      <div className={styles.card}>
        <h1 className={styles.brandTitle}>
          <BrandMark size={46} />
          Date2gether
        </h1>
        <p className={styles.subtitle} data-testid="subtitle">
          {t('Videollamadas simples, en el navegador.')}
        </p>

        {!checkingSession && (
          <div className={styles.authBar} data-testid="auth-bar">
            {user ? (
              <>
                <span>
                  {t('Conectado como')} <strong>{user.name}</strong>
                </span>
                <button type="button" className={styles.linkButton} onClick={handleLogout}>
                  {t('Cerrar sesión')}
                </button>
              </>
            ) : (
              <span className={styles.authLinks}>
                <Link href="/login">{t('Iniciar sesión')}</Link>
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
          {loggedIn && (
            <label className={styles.permanentToggle}>
              <input
                type="checkbox"
                checked={isPermanent}
                onChange={(event) => setIsPermanent(event.target.checked)}
              />
              {t('Sala permanente (enlace fijo, con sala de espera siempre activa)')}
            </label>
          )}
          {loggedIn && isPermanent && (
            <>
              <label htmlFor="room-name">{t('Nombre de la sala')}</label>
              <input
                id="room-name"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder={t('Opcional: ej. "Grupo de los jueves"')}
                maxLength={100}
              />
            </>
          )}
          {loggedIn && isPermanent && <ScheduleSlotEditor slots={slots} onChange={setSlots} />}
          {/* Logged out: plain button + onClick so the name input's `required` cannot block the redirect. */}
          <button
            type={loggedIn ? 'submit' : 'button'}
            onClick={loggedIn ? undefined : redirectToLogin}
            disabled={loading}
          >
            {loading ? t('Creando…') : t('Crear reunión')}
          </button>
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
