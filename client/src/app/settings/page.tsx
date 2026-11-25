'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { AvatarSettingsSection } from '@/features/avatar/AvatarSettingsSection';
import { toAvatar } from '@/features/avatar/catalog';
import { useAvatarStore } from '@/features/avatar/store';
import { CallLayoutEditor } from '@/features/calls/layout/CallLayoutEditor';
import { useCallSettingsStore, type CallPreference } from '@/features/calls/settings/store';
import { ToggleSwitch } from '@/features/calls/settings/ToggleSwitch';
import { isMentionSoundEnabled, setMentionSoundEnabled } from '@/features/chat/mentionPreferences';
import { ApiError, updateNameColor } from '@/lib/api';
import { getCurrentUser, isLoggedIn } from '@/lib/auth';
import { NAME_COLOR_HEX, NAME_COLOR_IDS, type NameColorId } from '@/lib/nameColors';
import { useTranslation } from '@/features/translation/useTranslation';
import { AppShell } from '@/features/navigation/AppShell';
import { useTheme } from '@/features/theme/useTheme';
import styles from './page.module.css';

// Nombres legibles de cada color, solo para el aria-label/title de cada muestra.
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

const SECTIONS = [
  { id: 'apariencia', label: 'Apariencia' },
  { id: 'notificaciones', label: 'Notificaciones' },
  { id: 'perfil', label: 'Perfil' },
  { id: 'llamadas', label: 'Llamadas' },
  { id: 'mosaicos', label: 'Mosaicos' },
] as const;

const CALL_TOGGLES: { key: CallPreference; label: string; hint: string }[] = [
  {
    key: 'mutedNudge',
    label: 'Avisarme si hablo silenciado',
    hint: 'Escucha tu micrófono solo en este navegador mientras está apagado.',
  },
  {
    key: 'noiseSuppression',
    label: 'Supresión de ruido',
    hint: 'Filtra ruidos de fondo constantes, como un ventilador.',
  },
  {
    key: 'backgroundBlur',
    label: 'Desenfocar el fondo',
    hint: 'Usa más procesador; si tu equipo va lento, dejalo apagado.',
  },
  {
    key: 'joinLeaveSounds',
    label: 'Sonido cuando alguien entra o sale',
    hint: 'Un tono corto al entrar y otro al salir.',
  },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {hint && <span className={styles.rowHint}>{hint}</span>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className={styles.panel} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.panelTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { theme, toggle: toggleTheme } = useTheme();
  const callPreferences = useCallSettingsStore();
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [selected, setSelected] = useState<NameColorId | null>(null);
  const [saving, setSaving] = useState<NameColorId | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Arranca prendido (el default) para no parpadear "apagado" antes de leer localStorage.
  const [mentionSoundEnabled, setMentionSoundEnabledState] = useState(true);

  useEffect(() => {
    setMentionSoundEnabledState(isMentionSoundEnabled());
  }, []);

  function handleMentionSound(next: boolean) {
    setMentionSoundEnabledState(next);
    setMentionSoundEnabled(next);
  }

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
        const savedAvatar = toAvatar(user?.avatar);
        if (savedAvatar) useAvatarStore.getState().setAvatar(savedAvatar);
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

  return (
    <AppShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <h1>{t('Configuración')}</h1>
          <p>{t('Se guarda en este navegador, salvo el color de tu nombre y tu avatar.')}</p>
        </header>

        <div className={styles.layout}>
          <nav className={styles.nav} aria-label={t('Secciones')}>
            {SECTIONS.map(({ id, label }) => (
              <a key={id} href={`#${id}`} className={styles.navLink}>
                {t(label)}
              </a>
            ))}
          </nav>

          <div className={styles.sections}>
            <Section id="apariencia" title={t('Apariencia')}>
              <Row label={t('Modo oscuro')}>
                <ToggleSwitch
                  checked={theme === 'dark'}
                  onChange={toggleTheme}
                  aria-label={t('Modo oscuro')}
                  data-testid="theme-toggle"
                />
              </Row>
            </Section>

            <Section id="notificaciones" title={t('Notificaciones')}>
              <Row
                label={t('Sonido al mencionarte')}
                hint={t('Suena cuando alguien te nombra con @ en el chat.')}
              >
                <ToggleSwitch
                  checked={mentionSoundEnabled}
                  onChange={handleMentionSound}
                  aria-label={t('Sonido al mencionarte')}
                  data-testid="mention-sound-toggle"
                />
              </Row>
            </Section>

            <Section id="perfil" title={t('Perfil')}>
              <Row label={t('Avatar')} hint={t('Se muestra cuando tenés la cámara apagada.')}>
                <AvatarSettingsSection />
              </Row>
              <div className={styles.block}>
                <div className={styles.rowText}>
                  <span className={styles.rowLabel}>{t('Elegí el color de tu nombre')}</span>
                  <span className={styles.rowHint}>
                    {t('Aparece en el chat y en el borde de tu video cuando hablás.')}
                  </span>
                </div>
                {loggedIn ? (
                  <>
                    <div
                      className={styles.palette}
                      role="group"
                      aria-label={t('Elegí el color de tu nombre')}
                    >
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
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#fff"
                                strokeWidth="3"
                                aria-hidden="true"
                              >
                                <path
                                  d="M4 12l6 6L20 6"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
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
                  </>
                ) : (
                  <div className={styles.loginHint}>
                    <p>{t('Necesitás iniciar sesión para elegir el color de tu nombre.')}</p>
                    <p className={styles.authLinks}>
                      <Link href="/login">{t('Iniciar sesión')}</Link>
                      <Link href="/register">{t('Crear cuenta')}</Link>
                    </p>
                  </div>
                )}
              </div>
            </Section>

            <Section id="llamadas" title={t('Llamadas')}>
              {CALL_TOGGLES.map(({ key, label, hint }) => (
                <Row key={key} label={t(label)} hint={t(hint)}>
                  <ToggleSwitch
                    checked={callPreferences[key]}
                    onChange={(value) => callPreferences.setPreference(key, value)}
                    aria-label={t(label)}
                  />
                </Row>
              ))}
            </Section>

            <Section id="mosaicos" title={t('Distribución de la pantalla en las llamadas')}>
              <div className={styles.block}>
                <CallLayoutEditor wide />
              </div>
            </Section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
