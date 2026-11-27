import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpOnlyThrottlerGuard } from '../../common/http-only-throttler.guard';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';

const reset = {
  requestReset: vi.fn(() => Promise.resolve()),
  resetPassword: vi.fn(() => Promise.resolve()),
};

let app: INestApplication | undefined;

async function startApp(): Promise<string> {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }])],
    controllers: [PasswordResetController],
    providers: [
      { provide: PasswordResetService, useValue: reset },
      { provide: APP_GUARD, useClass: HttpOnlyThrottlerGuard },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0);
  return app.getUrl();
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('recuperar la contraseña (HTTP)', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await app?.close();
    app = undefined;
  });

  it('pedir el link responde siempre el mismo mensaje, exista o no la cuenta', async () => {
    const base = await startApp();

    const res = await post(`${base}/auth/forgot-password`, { email: 'ana@example.test' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Si existe una cuenta con ese email, te mandamos un link.');
    expect(reset.requestReset).toHaveBeenCalledWith('ana@example.test');
  });

  it('pedir el link tiene un límite de 5 por minuto por IP', async () => {
    const base = await startApp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await post(`${base}/auth/forgot-password`, { email: 'ana@example.test' })).status,
      );
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('la contraseña nueva sigue las mismas reglas que el registro', async () => {
    const base = await startApp();

    const weak = await post(`${base}/auth/reset-password`, { token: 'abc', password: 'corta' });
    const ok = await post(`${base}/auth/reset-password`, {
      token: 'abc',
      password: 'NuevaClave123',
    });

    expect(weak.status).toBe(400);
    expect(reset.resetPassword).toHaveBeenCalledTimes(1);
    expect(reset.resetPassword).toHaveBeenCalledWith('abc', 'NuevaClave123');
    expect(ok.status).toBe(200);
    expect(ok.body.message).toBe('Listo, ya podés entrar con tu contraseña nueva.');
  });
});
