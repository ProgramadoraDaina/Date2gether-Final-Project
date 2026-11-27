'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { requestPasswordReset } from '@/lib/auth';
import { useTranslation } from '@/features/translation/useTranslation';
import styles from '../login/page.module.css';

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setSent(await requestPasswordReset(email.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('No se pudo enviar el link'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.card}>
      <h1>{t('Recuperar contraseña')}</h1>
      {sent ? (
        <p className={styles.subtitle} role="status">
          {t(sent)}
        </p>
      ) : (
        <>
          <p className={styles.subtitle}>
            {t('Escribí el email de tu cuenta y te mandamos un link para elegir una nueva.')}
          </p>
          <form onSubmit={handleSubmit}>
            <label htmlFor="email">{t('Email')}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <button type="submit" disabled={loading}>
              {loading ? t('Enviando…') : t('Mandarme el link')}
            </button>
          </form>
        </>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {t(error)}
        </p>
      )}

      <p className={styles.switchLink}>
        <Link href="/login">{t('Volver a iniciar sesión')}</Link>
      </p>
    </div>
  );
}
