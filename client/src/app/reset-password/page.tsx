'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { resetPassword } from '@/lib/auth';
import { useTranslation } from '@/features/translation/useTranslation';
import styles from '../login/page.module.css';

function ResetPasswordForm() {
  const { t } = useTranslation();
  const token = useSearchParams().get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (password !== confirm) {
      setError(t('Las contraseñas no coinciden'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setDone(await resetPassword(token, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('No se pudo cambiar la contraseña'));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <>
        <p className={styles.error} role="alert">
          {t('Este link no es válido.')}
        </p>
        <p className={styles.switchLink}>
          <Link href="/forgot-password">{t('Pedir un link nuevo')}</Link>
        </p>
      </>
    );
  }

  if (done) {
    return (
      <>
        <p className={styles.subtitle} role="status">
          {t(done)}
        </p>
        <p className={styles.switchLink}>
          <Link href="/login">{t('Iniciar sesión')}</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <p className={styles.subtitle}>
        {t('Elegí una contraseña con al menos 8 caracteres, una letra y un número.')}
      </p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="password">{t('Contraseña nueva')}</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
        <label htmlFor="confirm">{t('Repetí la contraseña')}</label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? t('Guardando…') : t('Cambiar contraseña')}
        </button>
      </form>
      {error && (
        <>
          <p className={styles.error} role="alert">
            {t(error)}
          </p>
          <p className={styles.switchLink}>
            <Link href="/forgot-password">{t('Pedir un link nuevo')}</Link>
          </p>
        </>
      )}
    </>
  );
}

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  return (
    <div className={styles.card}>
      <h1>{t('Elegir contraseña nueva')}</h1>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
