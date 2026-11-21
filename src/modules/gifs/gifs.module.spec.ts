import { describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DRIZZLE, DrizzleModule } from '../../db/drizzle.module';
import { GifsModule } from './gifs.module';
import { GifsService } from './gifs.service';

describe('GifsModule', () => {
  // JwtAuthModule (vía RoomResolverModule) necesita DRIZZLE ahora que
  // RoomAccessGuard resuelve la sala real antes de autorizar; se mockea
  // porque este test solo verifica que el wiring de DI compila.
  it('resuelve el GifsService con sus dependencias conectadas', async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DrizzleModule, GifsModule],
    })
      .overrideProvider(DRIZZLE)
      .useValue({})
      .compile();

    expect(module.get(GifsService)).toBeInstanceOf(GifsService);
  });
});
