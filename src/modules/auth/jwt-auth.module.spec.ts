import { describe, expect, it } from '@jest/globals';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DRIZZLE, DrizzleModule } from '../../db/drizzle.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtAuthModule } from './jwt-auth.module';

describe('JwtAuthModule', () => {
  // Desde RoomResolverModule (vía RoomAccessGuard), JwtAuthModule pasó a
  // depender de DRIZZLE: el binding de token->sala (assertBound) necesita
  // resolver la sala real. Se mockea porque este test solo verifica que el
  // wiring de DI compila, no toca la base real.
  it('resuelve el JwtAuthGuard con RoomResolverModule conectado', async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), DrizzleModule, JwtAuthModule],
    })
      .overrideProvider(DRIZZLE)
      .useValue({})
      .compile();

    const guard = module.get(JwtAuthGuard);

    expect(guard).toBeInstanceOf(JwtAuthGuard);
  });
});
