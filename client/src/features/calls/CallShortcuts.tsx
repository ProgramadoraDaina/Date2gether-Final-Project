'use client';

import { useLocalParticipant } from '@livekit/components-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from '../translation/useTranslation';
import { useHands } from './hands/HandsProvider';
import { useCallSettingsStore } from './settings/store';
import { SHORTCUTS, shortcutFor } from './shortcuts';
import styles from './MeetingRoom.module.css';

interface CallShortcutsProps {
  audioLocked: boolean;
  videoLocked: boolean;
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
}

export function CallShortcuts({
  audioLocked,
  videoLocked,
  helpOpen,
  onHelpOpenChange,
}: CallShortcutsProps) {
  const { t } = useTranslation();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const { toggle: toggleHand } = useHands();
  const remember = useCallSettingsStore((state) => state.setDeviceEnabled);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // El listener se registra una vez; lee el estado vigente por ref.
  const latest = useRef({ isMicrophoneEnabled, isCameraEnabled, audioLocked, videoLocked });
  latest.current = { isMicrophoneEnabled, isCameraEnabled, audioLocked, videoLocked };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutFor(event);
      if (!action) return;
      event.preventDefault();
      const state = latest.current;
      if (action === 'microphone' && !state.audioLocked) {
        remember('microphone', !state.isMicrophoneEnabled);
        void localParticipant
          .setMicrophoneEnabled(!state.isMicrophoneEnabled)
          .catch(() => undefined);
      } else if (action === 'camera' && !state.videoLocked) {
        remember('camera', !state.isCameraEnabled);
        void localParticipant.setCameraEnabled(!state.isCameraEnabled).catch(() => undefined);
      } else if (action === 'hand') toggleHand();
      else if (action === 'help') onHelpOpenChange(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [localParticipant, toggleHand, remember, onHelpOpenChange]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.showModal) return;
    if (helpOpen && !dialog.open) dialog.showModal();
    if (!helpOpen && dialog.open) dialog.close();
  }, [helpOpen]);

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.confirmDialog} ${styles.shortcutsDialog}`}
      onClose={() => onHelpOpenChange(false)}
      onClick={(event) => {
        if (event.target === event.currentTarget) onHelpOpenChange(false);
      }}
      aria-labelledby="call-shortcuts-title"
    >
      <h2 id="call-shortcuts-title" className={styles.shortcutsTitle}>
        {t('Atajos de teclado')}
      </h2>
      <dl className={styles.shortcutsList}>
        {SHORTCUTS.map(({ action, keys, label }) => (
          <div key={action} className={styles.shortcutRow}>
            <dt>{t(label)}</dt>
            <dd>
              <kbd>{keys}</kbd>
            </dd>
          </div>
        ))}
      </dl>
      <button type="button" className="secondary" onClick={() => onHelpOpenChange(false)}>
        {t('Cerrar')}
      </button>
    </dialog>
  );
}
