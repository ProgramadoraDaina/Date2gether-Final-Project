'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { register } from '@/lib/auth';
import { useTranslation } from '@/features/translation/useTranslation';

const NAME_KEY = 'date2gether:userName';

export default function RegisterPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const user = await register(email.trim(), password, name.trim());
      localStorage.setItem(NAME_KEY, user.name);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('No se pudo crear la cuenta'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h1>{t('Crear cuenta')}</h1>
      <p className="subtitle">{t('Registrate para usar Date2gether.')}</p>

      <form onSubmit={handleSubmit}>
        <label htmlFor="name">{t('Nombre')}</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          required
        />

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
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="hint">{t('Mínimo 8 caracteres, con al menos una letra y un número.')}</p>

        <button type="submit" disabled={loading}>
          {loading ? t('Creando cuenta…') : t('Crear cuenta')}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      <p className="switch-link">
        {t('¿Ya tenés cuenta? ')}
        <Link href="/login">{t('Iniciá sesión')}</Link>
      </p>
    </div>
  );
}
