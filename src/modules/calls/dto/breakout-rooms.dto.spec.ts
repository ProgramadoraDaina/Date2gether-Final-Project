import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateBreakoutRoomDto } from './create-breakout-room.dto';
import { UpdateBreakoutRoomDto } from './update-breakout-room.dto';

// Decisión 3 (design.md "joinPolicy: esquema, migración y autorización",
// tasks.md 3.3): joinPolicy validado con el mismo patrón que leavePolicy ya
// usa (@IsIn), en los mismos dos DTOs.
describe('[3.3] CreateBreakoutRoomDto.joinPolicy', () => {
  it('admin_only es válido', async () => {
    const dto = plainToInstance(CreateBreakoutRoomDto, { joinPolicy: 'admin_only' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('open es válido', async () => {
    const dto = plainToInstance(CreateBreakoutRoomDto, { joinPolicy: 'open' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('ausente es válido (opcional)', async () => {
    const dto = plainToInstance(CreateBreakoutRoomDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('un valor fuera de la unión se rechaza', async () => {
    const dto = plainToInstance(CreateBreakoutRoomDto, { joinPolicy: 'public' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('joinPolicy');
  });
});

describe('[3.3] UpdateBreakoutRoomDto.joinPolicy', () => {
  it('admin_only y open son válidos', async () => {
    expect(
      await validate(plainToInstance(UpdateBreakoutRoomDto, { joinPolicy: 'admin_only' })),
    ).toHaveLength(0);
    expect(
      await validate(plainToInstance(UpdateBreakoutRoomDto, { joinPolicy: 'open' })),
    ).toHaveLength(0);
  });

  it('un valor fuera de la unión se rechaza', async () => {
    const dto = plainToInstance(UpdateBreakoutRoomDto, { joinPolicy: 'invalid' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('joinPolicy');
  });

  it('cambiar joinPolicy no exige leavePolicy ni viceversa (dos controles independientes)', async () => {
    expect(
      await validate(plainToInstance(UpdateBreakoutRoomDto, { joinPolicy: 'open' })),
    ).toHaveLength(0);
    expect(
      await validate(plainToInstance(UpdateBreakoutRoomDto, { leavePolicy: 'free_return' })),
    ).toHaveLength(0);
  });
});
