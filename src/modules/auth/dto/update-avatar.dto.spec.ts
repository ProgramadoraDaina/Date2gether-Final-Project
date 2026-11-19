import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAvatarDto } from './update-avatar.dto';

describe('UpdateAvatarDto', () => {
  it('acepta piezas del catálogo con colores hex por pieza y sticker', async () => {
    const dto = plainToInstance(UpdateAvatarDto, {
      head: ['cap', 'crown'],
      face: ['mustache'],
      colors: { 'head:cap': '#3d7be0', 'head:crown': '#f2c14e' },
      sticker: true,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza una pieza que no existe y un color que no es hex', async () => {
    const dto = plainToInstance(UpdateAvatarDto, {
      head: ['dominus'],
      colors: { 'face:mustache': 'red' },
      sticker: false,
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property).sort()).toEqual(['colors', 'head']);
  });

  it('rechaza una clave de color cuya pieza no está en ese slot', async () => {
    const dto = plainToInstance(UpdateAvatarDto, {
      head: ['cap'],
      colors: { 'head:mustache': '#3d7be0' },
      sticker: true,
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['colors']);
  });
});
