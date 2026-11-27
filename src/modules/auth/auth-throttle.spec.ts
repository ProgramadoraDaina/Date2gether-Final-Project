import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpOnlyThrottlerGuard } from '../../common/http-only-throttler.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const authService = {
  login: () => Promise.resolve({ accessToken: 'a' }),
  register: () => Promise.resolve({ accessToken: 'a' }),
  refresh: () => Promise.resolve({ accessToken: 'a' }),
};

let app: INestApplication | undefined;

async function startApp(): Promise<string> {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
    controllers: [AuthController],
    providers: [
      { provide: AuthService, useValue: authService },
      { provide: APP_GUARD, useClass: HttpOnlyThrottlerGuard },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = moduleRef.createNestApplication();
  await app.listen(0);
  return app.getUrl();
}

async function postTimes(url: string, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ana@example.com', password: 'Password123', refreshToken: 'r' }),
    });
    statuses.push(res.status);
  }
  return statuses;
}

describe('límite de intentos en login y registro', () => {
  afterEach(async () => {
    delete process.env.AUTH_THROTTLE_LIMIT;
    await app?.close();
    app = undefined;
  });

  it('el login responde 429 al intento 11 dentro del mismo minuto', async () => {
    const base = await startApp();

    const statuses = await postTimes(`${base}/auth/login`, 11);

    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('el registro responde 429 al intento 11 dentro del mismo minuto', async () => {
    const base = await startApp();

    const statuses = await postTimes(`${base}/auth/register`, 11);

    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('AUTH_THROTTLE_LIMIT cambia el tope', async () => {
    process.env.AUTH_THROTTLE_LIMIT = '3';
    const base = await startApp();

    const statuses = await postTimes(`${base}/auth/login`, 4);

    expect(statuses).toEqual([201, 201, 201, 429]);
  });

  it('refresh sigue con el límite global, no con el de login', async () => {
    const base = await startApp();

    const statuses = await postTimes(`${base}/auth/refresh`, 11);

    expect(statuses.every((status) => status === 201)).toBe(true);
  });
});
