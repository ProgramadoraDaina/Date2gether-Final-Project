'use client';

import Link from 'next/link';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { ThemeToggle } from '@/features/theme/ThemeToggle';
import { LanguageToggle } from '@/features/translation/LanguageToggle';
import { useTranslation } from '@/features/translation/useTranslation';
import styles from './RoomSidebar.module.css';

interface RoomSidebarProps {
  code: string;
  copied: boolean;
  onCopyLink: () => void;
  onOpenEmojis: () => void;
  // Controlan el colapso animado y el ancho elegido con el handle de resize
  // (ver useResizablePanel en RoomPage). El wrapper externo anima `width`
  // entre 0 y `width`; el contenido interno mantiene `width` fijo para no
  // reflowear mientras se cierra, solo queda clippeado por overflow:hidden.
  open: boolean;
  width: number;
  onResizeHandleMouseDown: (e: ReactMouseEvent) => void;
  // undefined mientras el socket de la sala todavía no existe (ver RoomPage):
  // sin él no hay con qué sincronizar la música, así que no hay nada para
  // mostrar todavía.
  musicPlayer?: ReactNode;
}

export function RoomSidebar({
  code,
  copied,
  onCopyLink,
  onOpenEmojis,
  open,
  width,
  onResizeHandleMouseDown,
  musicPlayer,
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

        <div className={styles.toggles}>
          <ThemeToggle />
          <LanguageToggle />
        </div>

        <button type="button" className={`secondary ${styles.emojisButton}`} onClick={onOpenEmojis}>
          {t('Emojis y sonidos')}
        </button>

        <div className={styles.bottomActions}>
          {musicPlayer}
          <button type="button" className={`secondary ${styles.copyLink}`} onClick={onCopyLink}>
            {t(copied ? 'Enlace copiado' : 'Copiar enlace')}
          </button>
        </div>
        {/* Única salida de la sala cuando la llamada todavía está
            conectando o falló (MeetingRoom, con su botón de "Colgar", ni
            se monta en esos casos): sin esto, la única forma de volver al
            inicio era el botón de atrás del navegador. */}
        <Link href="/" className={styles.leaveLink}>
          {t('Salir')}
        </Link>
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
