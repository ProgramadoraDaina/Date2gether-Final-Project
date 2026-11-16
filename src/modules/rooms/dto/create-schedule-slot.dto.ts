import { IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { IsIanaTimezone } from '../validators/is-iana-timezone.validator';

// 'HH:MM', 24h wall-clock — same shape the DB CHECK constraint enforces
// (room_schedule_slots_time_of_day_valid, design.md D6).
const TIME_OF_DAY_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export class CreateScheduleSlotDto {
  // 0 = Sunday … 6 = Saturday — same convention as Date#getDay() (D6).
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsString()
  @Matches(TIME_OF_DAY_PATTERN, {
    message: 'timeOfDay debe tener el formato HH:MM (24 horas)',
  })
  timeOfDay: string;

  // IANA zone name, never a numeric offset — enforced by IsIanaTimezone (D6).
  @IsIanaTimezone()
  timezone: string;
}
