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
  // Solo llega con contenido cuando quien mira es admin (ver RoomPage):
  // AdmissionControl ya trae su propio botón + dialog, así que acá entra
  // como un nodo más de bottomActions, igual que musicPlayer.
  admissionControl?: ReactNode;
  // true mientras hay algún intento de llamada en curso (conectando, en
  // llamada, o reintentando tras un error): esos tres estados ya tienen su
  // propio botón "Colgar" con confirmación (ver HangUpButton.tsx, usado
  // tanto en MeetingRoom como en el callLoadingPanel de RoomPage). Mostrar
  // "Salir" al mismo tiempo era la confusión reportada: dos botones para
  // "irme", uno pregunta y el otro no.
  inCall: boolean;
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
  admissionControl,
  inCall,
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
          <strong className={styles.brandName}>Date2gether</strong>
          <span className={styles.code}>{code}</span>
        </div>

        <div className={styles.toggles}>
          <ThemeToggle />
          <LanguageToggle />
        </div>

        <div className={styles.bottomActions}>
          {musicPlayer}
          {admissionControl}
          <button type="button" className={`secondary ${styles.emojisButton}`} onClick={onOpenEmojis}>
            {t('Emojis y sonidos')}
          </button>
          <button type="button" className={`secondary ${styles.copyLink}`} onClick={onCopyLink}>
            {t(copied ? 'Enlace copiado' : 'Copiar enlace')}
          </button>
        </div>
        {/* Única salida de la sala cuando la llamada todavía está
            conectando o falló (MeetingRoom, con su botón de "Colgar", ni
            se monta en esos casos): sin esto, la única forma de volver al
            inicio era el botón de atrás del navegador. Con la llamada ya
            activa se oculta: "Colgar" (con su confirmación) pasa a ser la
            única salida, en vez de convivir con esta que sale sin preguntar. */}
        {!inCall && (
          <Link href="/" className={styles.leaveLink}>
            {t('Salir')}
          </Link>
        )}
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
