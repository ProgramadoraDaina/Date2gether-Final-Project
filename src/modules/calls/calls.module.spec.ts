import { describe, expect, it } from '@jest/globals';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DRIZZLE, DrizzleModule } from '../../db/drizzle.module';
import { CallsModule } from './calls.module';
import { CallsService } from './calls.service';

describe('CallsModule', () => {
  it('resuelve el CallsService con sus dependencias conectadas', async () => {
    // RoomsModule (vía CallsModule) necesita DRIZZLE; se mockea porque este
    // test solo verifica que el wiring de DI compila, no toca la base real.
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DrizzleModule, CallsModule],
    })
      .overrideProvider(DRIZZLE)
      .useValue({})
      .compile();

    const service = module.get(CallsService);

    expect(service).toBeInstanceOf(CallsService);
  });
});
