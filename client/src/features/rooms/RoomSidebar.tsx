'use client';

import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { CallControls } from '@/features/calls/CallControls';
import type { CallSessionState } from '@/features/calls/useCallSession';
import { ThemeToggle } from '@/features/theme/ThemeToggle';
import { LanguageToggle } from '@/features/translation/LanguageToggle';
import { useTranslation } from '@/features/translation/useTranslation';
import styles from './RoomSidebar.module.css';

interface RoomSidebarProps {
  code: string;
  roomToken: string;
  callSession: CallSessionState;
  copied: boolean;
  onCopyLink: () => void;
  // Controlan el colapso animado y el ancho elegido con el handle de resize
  // (ver useResizablePanel en RoomPage). El wrapper externo anima `width`
  // entre 0 y `width`; el contenido interno mantiene `width` fijo para no
  // reflowear mientras se cierra, solo queda clippeado por overflow:hidden.
  open: boolean;
  width: number;
  onResizeHandleMouseDown: (e: ReactMouseEvent) => void;
}

export function RoomSidebar({
  code,
  roomToken,
  callSession,
  copied,
  onCopyLink,
  open,
  width,
  onResizeHandleMouseDown,
}: RoomSidebarProps) {
  const { t } = useTranslation();

  return (
    <div
      className={styles.sidebarWrap}
      data-open={open}
      style={{ '--sidebar-width': `${width}px` } as CSSProperties}
    >
      <div className={styles.sidebar} style={{ width }}>
        <div className={styles.brand}>
          <strong>Date2gether</strong> <span className={styles.code}>{code}</span>
        </div>

        <CallControls roomCode={code} roomToken={roomToken} session={callSession} />

        <div className={styles.toggles}>
          <ThemeToggle />
          <LanguageToggle />
        </div>

        <button type="button" className={`secondary ${styles.copyLink}`} onClick={onCopyLink}>
          {t(copied ? 'Enlace copiado' : 'Copiar enlace')}
        </button>
      </div>
      <div
        className={styles.resizeHandle}
        onMouseDown={onResizeHandleMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('Ajustar ancho del panel lateral')}
      />
    </div>
  );
}
