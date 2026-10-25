import { describe, expect, it } from '@jest/globals';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtAuthModule } from './jwt-auth.module';

describe('JwtAuthModule', () => {
  it('resuelve el JwtAuthGuard sin depender de ningún módulo de persistencia', async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), JwtAuthModule],
    }).compile();

    const guard = module.get(JwtAuthGuard);

    expect(guard).toBeInstanceOf(JwtAuthGuard);
  });
});
