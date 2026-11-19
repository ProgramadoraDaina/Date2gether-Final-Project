import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAvatarDto } from './update-avatar.dto';

describe('UpdateAvatarDto', () => {
  it('acepta piezas del catálogo con colores hex y sticker', async () => {
    const dto = plainToInstance(UpdateAvatarDto, {
      head: 'cap',
      face: 'mustache',
      colors: { head: '#3d7be0' },
      sticker: true,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza una pieza que no existe y un color que no es hex', async () => {
    const dto = plainToInstance(UpdateAvatarDto, {
      head: 'dominus',
      colors: { face: 'red' },
      sticker: false,
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property).sort()).toEqual(['colors', 'head']);
  });
});
