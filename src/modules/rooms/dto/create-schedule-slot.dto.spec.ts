import { describe, expect, it } from '@jest/globals';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateScheduleSlotDto } from './create-schedule-slot.dto';

describe('CreateScheduleSlotDto', () => {
  it('acepta un slot válido', async () => {
    const dto = plainToInstance(CreateScheduleSlotDto, {
      dayOfWeek: 2,
      timeOfDay: '07:00',
      timezone: 'America/Argentina/Buenos_Aires',
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza dayOfWeek fuera de 0-6', async () => {
    const dto = plainToInstance(CreateScheduleSlotDto, {
      dayOfWeek: 7,
      timeOfDay: '07:00',
      timezone: 'UTC',
    });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('dayOfWeek');
  });

  it('rechaza un timeOfDay mal formado', async () => {
    const dto = plainToInstance(CreateScheduleSlotDto, {
      dayOfWeek: 2,
      timeOfDay: '7:00',
      timezone: 'UTC',
    });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('timeOfDay');
  });

  it('rechaza una zona horaria inválida, delegando en IsIanaTimezone', async () => {
    const dto = plainToInstance(CreateScheduleSlotDto, {
      dayOfWeek: 2,
      timeOfDay: '07:00',
      timezone: 'America/Buenos_Aire',
    });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('timezone');
  });
});
