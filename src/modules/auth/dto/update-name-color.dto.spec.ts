import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NAME_COLOR_IDS } from '../../../db/schema';
import { UpdateNameColorDto } from './update-name-color.dto';

describe('UpdateNameColorDto', () => {
  it.each(NAME_COLOR_IDS)('acepta el color de paleta "%s"', async (nameColor) => {
    const dto = plainToInstance(UpdateNameColorDto, { nameColor });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza un color que no está en la paleta fija', async () => {
    const dto = plainToInstance(UpdateNameColorDto, { nameColor: 'blue' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('nameColor');
  });

  it('rechaza un valor hexadecimal en lugar del id de la paleta', async () => {
    const dto = plainToInstance(UpdateNameColorDto, { nameColor: '#9D00FF' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });
});
