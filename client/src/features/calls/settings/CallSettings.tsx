'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarDialog } from '@/features/avatar/AvatarDialog';
import { useDismiss } from '@/lib/useDismiss';
import { useTranslation } from '@/features/translation/useTranslation';
import { CallLayoutEditor } from '../layout/CallLayoutEditor';
import { useCallLayoutStore } from '../layout/store';
import { useCallSettingsStore, type CallPreference, type CaptionSize } from './store';
import { ToggleSwitch } from './ToggleSwitch';
import type { PictureInPictureControl } from '../PictureInPicture';
import { useTheme } from '@/features/theme/useTheme';
import { LanguagePicker } from '@/features/translation/LanguagePicker';
import styles from './CallSettings.module.css';

const CAPTION_SIZES: { value: CaptionSize; label: string }[] = [
  { value: 'small', label: 'Chica' },
  { value: 'medium', label: 'Mediana' },
  { value: 'large', label: 'Grande' },
];

// Preferencias de esta persona; las de toda la sala quedan abajo, solo para admins.
const PERSONAL_TOGGLES: { key: CallPreference; label: string }[] = [
  { key: 'mutedNudge', label: 'Avisarme si hablo silenciado' },
  { key: 'noiseSuppression', label: 'Supresión de ruido' },
  { key: 'backgroundBlur', label: 'Desenfocar el fondo' },
  { key: 'joinLeaveSounds', label: 'Sonido cuando alguien entra o sale' },
];

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

type View = 'menu' | 'captions' | 'layout';

interface CallSettingsButtonProps {
  buttonClassName: string;
  isAdmin: boolean;
  audioLocked: boolean;
  videoLocked: boolean;
  onSetAudioLock: (locked: boolean) => void;
  onSetVideoLock: (locked: boolean) => void;
  nameFocusEnabled: boolean;
  onSetNameFocus: (enabled: boolean) => void;
  onShowShortcuts?: () => void;
  pictureInPicture?: PictureInPictureControl;
}

export function CallSettingsButton({
  buttonClassName,
  isAdmin,
  audioLocked,
  videoLocked,
  onSetAudioLock,
  onSetVideoLock,
  nameFocusEnabled,
  onSetNameFocus,
  onShowShortcuts,
  pictureInPicture,
}: CallSettingsButtonProps) {
  const { t } = useTranslation();
  const { captionSize, setCaptionSize, setPreference } = useCallSettingsStore();
  const preferences = useCallSettingsStore();
  const { theme, toggle: toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('menu');
  const [avatarOpen, setAvatarOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setView('menu');
  }, []);
  useDismiss(open, wrapRef, close);
  const label = t('Ajustes de la llamada');
  const captionsLabel = t('Tamaño de los subtítulos');
  const currentSize = CAPTION_SIZES.find((size) => size.value === captionSize);
  const layoutEnabled = useCallLayoutStore((state) => state.enabled && state.zones.length > 0);
  const setLayoutEditing = useCallLayoutStore((state) => state.setEditing);
  const layoutLabel = t('Mosaicos');
  const editingLayout = open && view === 'layout';
  useEffect(() => {
    setLayoutEditing(editingLayout);
    return () => setLayoutEditing(false);
  }, [editingLayout, setLayoutEditing]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => (open ? close() : setOpen(true))}
        title={label}
        aria-label={label}
        aria-expanded={open}
      >
        <SettingsIcon />
      </button>
      {open && (
        <div
          className={`${styles.panel} ${view === 'layout' ? styles.panelWide : ''}`}
          role="dialog"
          aria-label={label}
        >
          {view === 'menu' ? (
            <ul className={styles.menu}>
              <li>
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => setView('captions')}
                >
                  <span>{captionsLabel}</span>
                  <span className={styles.menuHint}>
                    {currentSize ? t(currentSize.label) : ''} ›
                  </span>
                </button>
              </li>
              <li>
                <button type="button" className={styles.menuItem} onClick={() => setView('layout')}>
                  <span>{layoutLabel}</span>
                  <span className={styles.menuHint}>
                    {t(layoutEnabled ? 'Personalizados' : 'Grilla')} ›
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    close();
                    setAvatarOpen(true);
                  }}
                >
                  <span>{t('Personalizar avatar')}</span>
                  <span className={styles.menuHint}>›</span>
                </button>
              </li>
              {pictureInPicture?.supported && (
                <li>
                  <button
                    type="button"
                    className={styles.menuItem}
                    aria-pressed={pictureInPicture.open}
                    onClick={() => {
                      close();
                      pictureInPicture.toggle();
                    }}
                  >
                    <span>
                      {t(
                        pictureInPicture.open
                          ? 'Cerrar ventana flotante'
                          : 'Abrir ventana flotante',
                      )}
                    </span>
                    <span className={styles.menuHint}>↗</span>
                  </button>
                </li>
              )}
              {onShowShortcuts && (
                <li className={styles.pointerOnly}>
                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      close();
                      onShowShortcuts();
                    }}
                  >
                    <span>{t('Atajos de teclado')}</span>
                    <span className={styles.menuHint}>?</span>
                  </button>
                </li>
              )}
              <li className={styles.menuItem}>
                <span>{t('Modo oscuro')}</span>
                <ToggleSwitch
                  checked={theme === 'dark'}
                  onChange={toggleTheme}
                  aria-label={t('Modo oscuro')}
                />
              </li>
              <li className={styles.menuItem}>
                <span>{t('Idioma')}</span>
                <LanguagePicker />
              </li>
              {PERSONAL_TOGGLES.map(({ key, label: toggleLabel }) => (
                <li key={key} className={styles.menuItem}>
                  <span>{t(toggleLabel)}</span>
                  <ToggleSwitch
                    checked={preferences[key]}
                    onChange={(value) => setPreference(key, value)}
                    aria-label={t(toggleLabel)}
                  />
                </li>
              ))}
              {isAdmin && (
                <>
                  <li className={styles.menuHeading}>{t('Para toda la sala')}</li>
                  <li className={styles.menuItem}>
                    <span>{t('Mutear a todos')}</span>
                    <ToggleSwitch
                      checked={audioLocked}
                      onChange={onSetAudioLock}
                      aria-label={t('Mutear a todos')}
                    />
                  </li>
                  <li className={styles.menuItem}>
                    <span>{t('Apagar cámaras de todos')}</span>
                    <ToggleSwitch
                      checked={videoLocked}
                      onChange={onSetVideoLock}
                      aria-label={t('Apagar cámaras de todos')}
                    />
                  </li>
                  <li className={styles.menuItem}>
                    <span>{t('Enfocar automáticamente al nombrar a alguien')}</span>
                    <ToggleSwitch
                      checked={nameFocusEnabled}
                      onChange={onSetNameFocus}
                      aria-label={t('Enfocar automáticamente al nombrar a alguien')}
                    />
                  </li>
                </>
              )}
            </ul>
          ) : (
            <>
              <div className={styles.subHead}>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setView('menu')}
                  aria-label={t('Volver')}
                  title={t('Volver')}
                >
                  ‹
                </button>
                <span className={styles.subTitle}>
                  {view === 'layout' ? layoutLabel : captionsLabel}
                </span>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={close}
                  aria-label={t('Cerrar')}
                  title={t('Cerrar')}
                >
                  ×
                </button>
              </div>
              {view === 'layout' ? (
                <div className={styles.layoutBody}>
                  <CallLayoutEditor showPreview={false} />
                </div>
              ) : (
                <fieldset className={styles.field}>
                  <legend className={styles.srOnly}>{captionsLabel}</legend>
                  <div className={styles.segmented}>
                    {CAPTION_SIZES.map(({ value, label: optionLabel }) => (
                      <label key={value} className={styles.option}>
                        <input
                          type="radio"
                          name="caption-size"
                          value={value}
                          checked={captionSize === value}
                          onChange={() => setCaptionSize(value)}
                        />
                        <span>{t(optionLabel)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </>
          )}
        </div>
      )}
      <AvatarDialog open={avatarOpen} onClose={() => setAvatarOpen(false)} />
    </div>
  );
}
