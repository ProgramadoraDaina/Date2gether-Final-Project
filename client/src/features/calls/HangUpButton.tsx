'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from '../translation/useTranslation';
import styles from './MeetingRoom.module.css';

function HangUpIcon() {
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
      {/* Auricular de "llamar" rotado 135° (convención de colgar), achicado para no recortar las puntas. */}
      <g transform="translate(12 12) rotate(135) scale(0.78) translate(-12 -12)">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
      </g>
    </svg>
  );
}

interface HangUpButtonProps {
  // Qué significa "salir" según quién lo use: dentro de la llamada ya
  // conectada (MeetingRoom) desconecta de LiveKit; desde la pantalla de
  // conectando/error (RoomPage, sin LiveKitRoom montado todavía) resetea el
  // intento y vuelve al inicio. El diálogo de confirmación es el mismo en
  // los dos casos — es el mismo riesgo ("se corta la llamada"), pase lo que
  // pase del lado de arriba.
  onConfirm: () => void;
  // Disparador por defecto: el círculo con el ícono de auricular del dock de
  // la llamada en vivo. La pantalla de conectando/error no tiene ese dock
  // (todavía no hay nada que colgar), así que ahí se pasa un botón de texto
  // en su lugar (ver RoomPage) — el diálogo de confirmación no cambia.
  className?: string;
  children?: ReactNode;
}

// Antes esto colgaba al toque con un solo click: muy fácil de tocar sin
// querer (en MeetingRoom está al lado de mic/cámara/pantalla, en el mismo
// dock) y sin forma de deshacerlo. Ahora siempre pide confirmación primero.
export function HangUpButton({ onConfirm, className, children }: HangUpButtonProps) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const label = t('Colgar');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmOpen && !dialog.open) dialog.showModal();
    if (!confirmOpen && dialog.open) dialog.close();
  }, [confirmOpen]);

  return (
    <>
      <button
        type="button"
        className={className ?? styles.hangUpButton}
        title={label}
        aria-label={label}
        onClick={() => setConfirmOpen(true)}
      >
        {children ?? <HangUpIcon />}
      </button>
      <dialog
        ref={dialogRef}
        className={styles.confirmDialog}
        onClose={() => setConfirmOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setConfirmOpen(false);
        }}
        aria-labelledby="hangup-confirm-text"
      >
        <p id="hangup-confirm-text">{t('¿Estás seguro de que querés salir de la llamada?')}</p>
        <div className={styles.confirmActions}>
          <button type="button" className="secondary" onClick={() => setConfirmOpen(false)}>
            {t('Cancelar')}
          </button>
          <button
            type="button"
            className={styles.confirmDangerButton}
            onClick={() => {
              setConfirmOpen(false);
              onConfirm();
            }}
          >
            {t('Salir de la llamada')}
          </button>
        </div>
      </dialog>
    </>
  );
}
