'use client';

import { useEffect, useState } from 'react';
import { ApiError, getAdminUsers, updateAdminUserRole, type AdminUser } from '@/lib/api';
import type { UserRole } from '@/lib/auth';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { useGlobalAccount } from '@/features/auth/useGlobalRole';
import { AppShell } from '@/features/navigation/AppShell';
import { useTranslation } from '@/features/translation/useTranslation';
import styles from './page.module.css';

export default function AdminPage() {
  return (
    <RequireAuth>
      <AdminGate />
    </RequireAuth>
  );
}

// RequireAuth redirige a /login si no hay sesión; acá se decide qué ve quien sí la tiene.
// Ocultar la pantalla es cosmético: el backend responde 403 a /admin/* si el rol no alcanza.
function AdminGate() {
  const { t } = useTranslation();
  const { role, userId, reload } = useGlobalAccount();

  if (role === 'loading' || role === 'anonymous') return null;

  // No se pudo averiguar el rol (red, 5xx): no es "sin acceso", se ofrece reintentar.
  if (role === 'error') {
    return (
      <AppShell>
        <div className={styles.card}>
          <h1>{t('Administración')}</h1>
          <p className={styles.error} role="alert">
            {t('No se pudo verificar tu cuenta. Revisá tu conexión e intentá de nuevo.')}
          </p>
          <button type="button" className={styles.retryButton} onClick={reload}>
            {t('Reintentar')}
          </button>
        </div>
      </AppShell>
    );
  }

  if (role !== 'admin') {
    return (
      <AppShell>
        <div className={styles.card}>
          <h1>{t('Sin acceso')}</h1>
          <p role="alert">{t('Necesitás ser administrador de la plataforma para ver esta página.')}</p>
        </div>
      </AppShell>
    );
  }

  return <AdminUsers currentUserId={userId} />;
}

function AdminUsers({ currentUserId }: { currentUserId: string | null }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  // Runs once on mount; `t` is left out so changing language does not refetch.
  useEffect(() => {
    getAdminUsers()
      .then(setUsers)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t('No se pudieron cargar los usuarios'));
      })
      .finally(() => setLoading(false));
  }, []);

  async function changeRole(user: AdminUser, role: UserRole) {
    if (role === user.role || savingId) return;
    setSavingId(user.id);
    setRowError(null);
    try {
      const updated = await updateAdminUserRole(user.id, role);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
    } catch (err) {
      setRowError({
        id: user.id,
        message: err instanceof ApiError ? err.message : t('No se pudo cambiar el rol'),
      });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AppShell>
      <div className={styles.card}>
        <h1>{t('Administración')}</h1>
        <p className={styles.subtitle}>{t('Usuarios de la plataforma y su rol global.')}</p>

        {loading && <p>{t('Cargando usuarios…')}</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {users.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('Nombre')}</th>
                  <th scope="col">{t('Email')}</th>
                  <th scope="col">{t('Rol')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td className={styles.email}>{user.email}</td>
                    <td>
                      <select
                        className={styles.roleSelect}
                        value={user.role}
                        // Quitarte tu propio rol de admin lo rechaza el backend (400): no se ofrece.
                        disabled={savingId === user.id || user.id === currentUserId}
                        aria-label={`${t('Rol de')} ${user.name}`}
                        onChange={(e) => void changeRole(user, e.target.value as UserRole)}
                      >
                        <option value="user">{t('Usuario')}</option>
                        <option value="admin">{t('Administrador')}</option>
                      </select>
                      {rowError?.id === user.id && (
                        <p className={styles.error} role="alert">
                          {rowError.message}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
