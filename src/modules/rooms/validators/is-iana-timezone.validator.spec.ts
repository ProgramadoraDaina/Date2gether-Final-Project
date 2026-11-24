import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { IsIanaTimezone } from './is-iana-timezone.validator';

class Dto {
  @IsIanaTimezone()
  timezone!: string;
}

describe('IsIanaTimezone', () => {
  it('acepta una zona IANA real', async () => {
    const dto = Object.assign(new Dto(), { timezone: 'America/Argentina/Buenos_Aires' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta UTC', async () => {
    const dto = Object.assign(new Dto(), { timezone: 'UTC' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza una zona inventada/con errata, en vez de dejarla pasar silenciosamente', async () => {
    const dto = Object.assign(new Dto(), { timezone: 'America/Buenos_Aire' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('timezone');
  });

  it('rechaza un offset numérico (no es un nombre de zona IANA)', async () => {
    const dto = Object.assign(new Dto(), { timezone: '-03:00' });
    expect(await validate(dto)).toHaveLength(1);
  });
});
