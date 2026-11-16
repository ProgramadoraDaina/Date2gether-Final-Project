import { useState, type FormEvent } from 'react';
import type { CreateScheduleSlot } from '@/lib/api';
import { useTranslation } from '../translation/useTranslation';
import styles from './ScheduleSlotEditor.module.css';

const DAY_LABELS = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
] as const;

// Same shape the DB CHECK constraint enforces server-side
// (room_schedule_slots_time_of_day_valid) — validated here too so a typo
// is caught before submit, not after a round-trip to the server.
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

interface ScheduleSlotEditorProps {
  slots: CreateScheduleSlot[];
  onChange: (slots: CreateScheduleSlot[]) => void;
}

export function ScheduleSlotEditor({ slots, onChange }: ScheduleSlotEditorProps) {
  const { t } = useTranslation();
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [timeOfDay, setTimeOfDay] = useState('');
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [error, setError] = useState<string | null>(null);

  function addSlot(event: FormEvent) {
    event.preventDefault();
    if (!TIME_OF_DAY_PATTERN.test(timeOfDay)) {
      setError(t('La hora debe tener el formato HH:MM (24 horas).'));
      return;
    }
    setError(null);
    onChange([...slots, { dayOfWeek, timeOfDay, timezone }]);
    setTimeOfDay('');
  }

  function removeSlot(index: number) {
    onChange(slots.filter((_, i) => i !== index));
  }

  return (
    <fieldset className={styles.editor}>
      <legend>{t('Horario semanal')}</legend>
      {slots.length === 0 && <p className={styles.empty}>{t('Todavía no agregaste ningún horario.')}</p>}
      <ul className={styles.list}>
        {slots.map((slot, index) => (
          <li key={`${slot.dayOfWeek}-${slot.timeOfDay}-${slot.timezone}`} className={styles.slot}>
            <span>
              {t(DAY_LABELS[slot.dayOfWeek])} {slot.timeOfDay} ({slot.timezone})
            </span>
            <button
              type="button"
              aria-label={t('Quitar horario')}
              onClick={() => removeSlot(index)}
            >
              {t('Quitar')}
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.row}>
        <label>
          {t('Día')}
          <select
            value={dayOfWeek}
            onChange={(event) => setDayOfWeek(Number(event.target.value))}
          >
            {DAY_LABELS.map((label, index) => (
              <option key={label} value={index}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Hora')}
          <input
            value={timeOfDay}
            onChange={(event) => setTimeOfDay(event.target.value)}
            placeholder="07:00"
          />
        </label>
        <label>
          {t('Zona horaria')}
          <input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
        </label>
        <button type="button" onClick={addSlot}>
          {t('Agregar horario')}
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
