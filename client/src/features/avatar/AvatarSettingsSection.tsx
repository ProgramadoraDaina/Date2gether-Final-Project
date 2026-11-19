'use client';

import { useState } from 'react';
import { useTranslation } from '../translation/useTranslation';
import { AvatarDialog } from './AvatarDialog';
import { AvatarFigure } from './AvatarFigure';
import { useAvatarStore } from './store';
import styles from './AvatarEditor.module.css';

export function AvatarSettingsSection({ className }: { className?: string }) {
  const { t } = useTranslation();
  const avatar = useAvatarStore((s) => s.avatar);
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      <div className={styles.settingsRow}>
        <div className={styles.settingsPreview}>
          <AvatarFigure avatar={avatar} label={t('Tu avatar')} />
        </div>
        <button type="button" onClick={() => setOpen(true)}>
          {t('Personalizar avatar')}
        </button>
      </div>
      <AvatarDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
