'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { login } from '@/lib/auth';
import { useTranslation } from '@/features/translation/useTranslation';
import styles from './page.module.css';

const NAME_KEY = 'date2gether:userName';

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const user = await login(email.trim(), password);
      localStorage.setItem(NAME_KEY, user.name);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('No se pudo iniciar sesión'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.card}>
      <h1>{t('Iniciar sesión')}</h1>
      <p className={styles.subtitle}>{t('Entrá con tu cuenta de Date2gether.')}</p>

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

        <label htmlFor="password">{t('Contraseña')}</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <button type="submit" disabled={loading}>
          {loading ? t('Entrando…') : t('Entrar')}
        </button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      <p className={styles.switchLink}>
        {t('¿No tenés cuenta? ')}
        <Link href="/register">{t('Creá una')}</Link>
      </p>
    </div>
  );
}
