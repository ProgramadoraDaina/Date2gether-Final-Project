'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import { useDismiss } from '@/lib/useDismiss';
import type { RoomEventParticipant } from './useRoomEvents';
import styles from './RoomEventButton.module.css';

interface RoomEventButtonProps {
  // Solo admin/colaborador puede armar un evento (misma vara que
  // RoomEmojisDialog): el padre decide si corresponde mostrar el botón.
  canManage: boolean;
  participants: RoomEventParticipant[];
  onStartRoulette(participantIds: string[]): void;
  onStartPoll(
    participantIds: string[],
    question: string,
    options: string[],
    config: { multipleChoice: boolean; anonymous: boolean },
  ): void;
  // Solo para el admin durante una llamada.
  onOpenBreakouts?: () => void;
}

const EMPTY_OPTIONS = ['', ''];
const MAX_POLL_OPTIONS = 10;

export function RoomEventButton({
  canManage,
  participants,
  onStartRoulette,
  onStartPoll,
  onOpenBreakouts,
}: RoomEventButtonProps) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [pollSelected, setPollSelected] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(EMPTY_OPTIONS);
  const [multipleChoice, setMultipleChoice] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const pollDialogRef = useRef<HTMLDialogElement>(null);

  useDismiss(
    menuOpen,
    wrapRef,
    useCallback(() => setMenuOpen(false), []),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pickerOpen && !dialog.open) dialog.showModal();
    if (!pickerOpen && dialog.open) dialog.close();
  }, [pickerOpen]);

  useEffect(() => {
    const dialog = pollDialogRef.current;
    if (!dialog) return;
    if (pollDialogOpen && !dialog.open) dialog.showModal();
    if (!pollDialogOpen && dialog.open) dialog.close();
  }, [pollDialogOpen]);

  const openRoulettePicker = useCallback(() => {
    setMenuOpen(false);
    // Por default entran todos los que están en la sala ahora mismo; de acá
    // se puede destildar a quien se quiera dejar afuera, o vaciar la
    // selección entera y armarla a mano (ver quickActions más abajo) — una
    // sola pantalla cubre las dos formas que pidió el usuario de ajustar
    // quién participa, en vez de un botón "ruleta" y otro separado
    // "personalizar ruleta" que terminan llevando al mismo lugar.
    setSelected(new Set(participants.map((p) => p.participantId)));
    setPickerOpen(true);
  }, [participants]);

  const openPollDialog = useCallback(() => {
    setMenuOpen(false);
    setPollSelected(new Set(participants.map((p) => p.participantId)));
    setQuestion('');
    setOptions(EMPTY_OPTIONS);
    setMultipleChoice(false);
    setAnonymous(false);
    setPollDialogOpen(true);
  }, [participants]);

  function toggle(participantId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(participantId)) next.delete(participantId);
      else next.add(participantId);
      return next;
    });
  }

  const allSelected = useMemo(
    () => participants.length > 0 && participants.every((p) => selected.has(p.participantId)),
    [participants, selected],
  );

  function handleSpin() {
    if (selected.size === 0) return;
    onStartRoulette([...selected]);
    setPickerOpen(false);
  }

  function togglePoll(participantId: string) {
    setPollSelected((prev) => {
      const next = new Set(prev);
      if (next.has(participantId)) next.delete(participantId);
      else next.add(participantId);
      return next;
    });
  }

  const allPollSelected = useMemo(
    () => participants.length > 0 && participants.every((p) => pollSelected.has(p.participantId)),
    [participants, pollSelected],
  );

  function updateOption(index: number, value: string) {
    setOptions((prev) => prev.map((option, i) => (i === index ? value : option)));
  }

  function addOption() {
    setOptions((prev) => (prev.length >= MAX_POLL_OPTIONS ? prev : [...prev, '']));
  }

  function removeOption(index: number) {
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  }

  const validOptions = options.map((option) => option.trim()).filter(Boolean);
  const canCreatePoll =
    question.trim().length > 0 && validOptions.length >= 2 && pollSelected.size > 0;

  function handleCreatePoll() {
    if (!canCreatePoll) return;
    onStartPoll([...pollSelected], question.trim(), validOptions, { multipleChoice, anonymous });
    setPollDialogOpen(false);
  }

  if (!canManage) return null;

  const label = t('Hacer evento');

  return (
    <>
      <div className={styles.wrap} ref={wrapRef}>
        <button
          type="button"
          className={styles.trigger}
          onClick={() => setMenuOpen((value) => !value)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          🎉 {label}
        </button>
        {menuOpen && (
          <div className={styles.menu} role="menu">
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={openRoulettePicker}
            >
              🎡 {t('Ruleta')}
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={openPollDialog}
            >
              📊 {t('Encuesta')}
            </button>
            {onOpenBreakouts && (
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onOpenBreakouts();
                }}
              >
                🚪 {t('Mini salas')}
              </button>
            )}
          </div>
        )}
      </div>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onClose={() => setPickerOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setPickerOpen(false);
        }}
      >
        <div className={styles.dialogHeader}>
          <h2>🎡 {t('Ruleta')}</h2>
          <button
            type="button"
            className={styles.dialogClose}
            onClick={() => setPickerOpen(false)}
            aria-label={t('Cerrar')}
          >
            ✕
          </button>
        </div>
        <div className={styles.quickActions}>
          <button
            type="button"
            onClick={() => setSelected(new Set(participants.map((p) => p.participantId)))}
            disabled={allSelected}
          >
            {t('Seleccionar todos')}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
          >
            {t('Vaciar selección')}
          </button>
        </div>
        {participants.length === 0 ? (
          <p className={styles.empty}>{t('Todavía no hay nadie más en la sala.')}</p>
        ) : (
          <ul className={styles.participantList}>
            {participants.map((p) => (
              <li key={p.participantId} className={styles.participantRow}>
                <input
                  type="checkbox"
                  id={`roulette-${p.participantId}`}
                  checked={selected.has(p.participantId)}
                  onChange={() => toggle(p.participantId)}
                />
                <label htmlFor={`roulette-${p.participantId}`}>{p.userName}</label>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.dialogActions}>
          <button type="button" className="secondary" onClick={() => setPickerOpen(false)}>
            {t('Cancelar')}
          </button>
          <button type="button" onClick={handleSpin} disabled={selected.size === 0}>
            {t('Girar ruleta')}
          </button>
        </div>
      </dialog>
      <dialog
        ref={pollDialogRef}
        className={styles.dialog}
        onClose={() => setPollDialogOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setPollDialogOpen(false);
        }}
      >
        <div className={styles.dialogHeader}>
          <h2>📊 {t('Encuesta')}</h2>
          <button
            type="button"
            className={styles.dialogClose}
            onClick={() => setPollDialogOpen(false)}
            aria-label={t('Cerrar')}
          >
            ✕
          </button>
        </div>
        <div className={styles.pollForm}>
          <label className={styles.pollLabel} htmlFor="poll-question">
            {t('Pregunta')}
          </label>
          <input
            id="poll-question"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('¿Qué querés preguntar?')}
          />
          <span className={styles.pollLabel}>{t('Opciones')}</span>
          {options.map((option, index) => (
            <div key={index} className={styles.pollOptionRow}>
              <input
                type="text"
                value={option}
                onChange={(e) => updateOption(index, e.target.value)}
                placeholder={t('Opción')}
                aria-label={`${t('Opción')} ${index + 1}`}
              />
              <button
                type="button"
                className={styles.pollRemoveOption}
                onClick={() => removeOption(index)}
                disabled={options.length <= 2}
                aria-label={t('Quitar opción')}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.pollAddOption}
            onClick={addOption}
            disabled={options.length >= MAX_POLL_OPTIONS}
          >
            + {t('Agregar opción')}
          </button>
          <label className={styles.pollCheckbox}>
            <input
              type="checkbox"
              checked={multipleChoice}
              onChange={(e) => setMultipleChoice(e.target.checked)}
            />
            {t('Permitir elegir varias opciones')}
          </label>
          <label className={styles.pollCheckbox}>
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
            />
            {t('Ocultar quién votó qué')}
          </label>
        </div>
        <div className={styles.quickActions}>
          <button
            type="button"
            onClick={() => setPollSelected(new Set(participants.map((p) => p.participantId)))}
            disabled={allPollSelected}
          >
            {t('Seleccionar todos')}
          </button>
          <button
            type="button"
            onClick={() => setPollSelected(new Set())}
            disabled={pollSelected.size === 0}
          >
            {t('Vaciar selección')}
          </button>
        </div>
        {participants.length === 0 ? (
          <p className={styles.empty}>{t('Todavía no hay nadie más en la sala.')}</p>
        ) : (
          <ul className={styles.participantList}>
            {participants.map((p) => (
              <li key={p.participantId} className={styles.participantRow}>
                <input
                  type="checkbox"
                  id={`poll-${p.participantId}`}
                  checked={pollSelected.has(p.participantId)}
                  onChange={() => togglePoll(p.participantId)}
                />
                <label htmlFor={`poll-${p.participantId}`}>{p.userName}</label>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.dialogActions}>
          <button type="button" className="secondary" onClick={() => setPollDialogOpen(false)}>
            {t('Cancelar')}
          </button>
          <button type="button" onClick={handleCreatePoll} disabled={!canCreatePoll}>
            {t('Crear encuesta')}
          </button>
        </div>
      </dialog>
    </>
  );
}
