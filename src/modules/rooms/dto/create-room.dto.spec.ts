import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRoomDto } from './create-room.dto';

describe('CreateRoomDto', () => {
  it('acepta un nombre solo, isPermanent y slots quedan undefined', async () => {
    const dto = plainToInstance(CreateRoomDto, { name: 'Reunión de Daina' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.isPermanent).toBeUndefined();
    expect(dto.slots).toBeUndefined();
  });

  it('acepta isPermanent y una lista de slots válidos', async () => {
    const dto = plainToInstance(CreateRoomDto, {
      name: 'Sala permanente',
      isPermanent: true,
      slots: [{ dayOfWeek: 2, timeOfDay: '07:00', timezone: 'UTC' }],
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza un slot inválido dentro de la lista (validación anidada)', async () => {
    const dto = plainToInstance(CreateRoomDto, {
      name: 'Sala permanente',
      slots: [{ dayOfWeek: 9, timeOfDay: '07:00', timezone: 'UTC' }],
    });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('slots');
  });
});
