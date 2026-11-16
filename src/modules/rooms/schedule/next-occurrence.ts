// Días 0=domingo … 6=sábado, misma convención que Date#getDay().
export interface ScheduleSlot {
  dayOfWeek: number;
  timeOfDay: string; // 'HH:MM', hora de pared en `timezone`.
  timezone: string;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface WallParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

function wallPartsInZone(instant: number, timeZone: string): WallParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) map[part.type] = part.value;
  // Algunos entornos ICU devuelven "24" para medianoche con hour12:false.
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    weekday: WEEKDAY_INDEX[map.weekday],
  };
}

// Offset (ms) tal que local = UTC + offset, derivado formateando `instant`
// en la zona y re-leyendo esas mismas cifras como si fueran UTC.
function offsetAt(instant: number, timeZone: string): number {
  const { year, month, day, hour, minute } = wallPartsInZone(instant, timeZone);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  return asUtc - instant;
}

// Corrección de offset en dos pasadas (design.md D6): necesaria porque el
// offset de una zona no es constante. Las dos pasadas puede divergir
// exactamente en una transición de DST:
// - Fall-back (hora ambigua): ambas pasadas convergen al MISMO instante --
//   el anterior a la transición (el offset de la pasada 1 "gana", D6).
// - Spring-forward (hora inexistente): las pasadas divergen porque cada
//   offset corresponde a un lado distinto del salto; la pasada 1 (offset
//   leído en `guess`, el lado de DESPUÉS del salto para una hora de pared
//   que cayó dentro del hueco) da el instante MÁS TARDE, la pasada 2 lo
//   "corrige" de vuelta al lado de ANTES. Tomar el máximo de las dos
//   pasadas resuelve ambos casos con la misma regla: nunca retrocede desde
//   la primera estimación, así que el hueco nunca puede devolver una hora
//   previa a la transición.
function wallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const pass1 = guess - offsetAt(guess, timeZone);
  const pass2 = guess - offsetAt(pass1, timeZone);
  return Math.max(pass1, pass2);
}

function parseTimeOfDay(timeOfDay: string): { hour: number; minute: number } {
  const [hour, minute] = timeOfDay.split(':').map(Number);
  return { hour, minute };
}

const MAX_DAYS_AHEAD = 7;

/**
 * Próxima ocurrencia de cualquiera de los slots, estrictamente después de
 * `now`. Pura: ninguna llamada a Date.now(), ningún estado compartido.
 *
 * Por slot: candidata por cada día 0..7 adelante, usando el mismo día
 * calendario + hora de pared leídos en la zona de `now` como punto de
 * partida. El día de la semana se RE-DERIVA del instante resultante (no se
 * confía en la aritmética) porque la corrección de offset puede cruzar
 * medianoche -- la zona es la única autoridad sobre qué día es ese.
 */
export function nextOccurrence(slots: ScheduleSlot[], now: Date): Date | null {
  let earliest: number | null = null;

  for (const slot of slots) {
    const { hour, minute } = parseTimeOfDay(slot.timeOfDay);
    const base = wallPartsInZone(now.getTime(), slot.timezone);

    for (let ahead = 0; ahead <= MAX_DAYS_AHEAD; ahead++) {
      const candidate = wallTimeToInstant(
        base.year,
        base.month,
        base.day + ahead,
        hour,
        minute,
        slot.timezone,
      );
      if (candidate <= now.getTime()) continue;

      const derivedWeekday = wallPartsInZone(candidate, slot.timezone).weekday;
      if (derivedWeekday !== slot.dayOfWeek) continue;

      if (earliest === null || candidate < earliest) earliest = candidate;
      break;
    }
  }

  return earliest === null ? null : new Date(earliest);
}
