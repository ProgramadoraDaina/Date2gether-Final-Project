import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller, Get, Logger, Module, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AppController } from './app.controller';
import { createApp } from './app-setup';

// Content-Type real que usa LiveKit para sus webhooks (ver design.md D6).
const LIVEKIT_WEBHOOK_CONTENT_TYPE = 'application/webhook+json';

// Controller mínimo solo para inspeccionar req.rawBody en estos tests; no es
// parte de ninguna ruta real de la API.
@Controller()
class RawBodyProbeController {
  @Post('probe')
  probe(@Req() req: RawBodyRequest<Request>) {
    return { rawBodyLength: req.rawBody ? req.rawBody.length : null };
  }
}

@Module({ controllers: [RawBodyProbeController] })
class RawBodyProbeModule {}

const openApps: NestExpressApplication[] = [];

beforeEach(() => {
  vi.stubEnv('CORS_ORIGIN', 'http://localhost:3002');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

async function listenOnEphemeralPort(app: NestExpressApplication): Promise<number> {
  openApps.push(app);
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('No se pudo obtener el puerto efímero de la app de prueba');
  }
  return address.port;
}

async function postProbe(
  port: number,
  contentType: string,
): Promise<{ rawBodyLength: number | null }> {
  const response = await fetch(`http://127.0.0.1:${port}/probe`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: JSON.stringify({ event: 'room_started' }),
  });
  return (await response.json()) as { rawBodyLength: number | null };
}

describe('bootstrap: rawBody + Content-Type de webhooks de LiveKit (design.md D6)', () => {
  it('[gotcha documentado] con rawBody:true pero SIN declarar el tipo de LiveKit, application/webhook+json llega con rawBody vacío', async () => {
    // Reproduce la configuración "naive" (solo rawBody: true, sin
    // useBodyParser) para documentar por qué el override de tipos es
    // necesario: el parser JSON de Express por defecto solo atiende
    // 'application/json', así que ni siquiera intenta leer el body y
    // req.rawBody nunca se completa.
    const app = await NestFactory.create<NestExpressApplication>(RawBodyProbeModule, {
      rawBody: true,
    });
    const port = await listenOnEphemeralPort(app);

    const result = await postProbe(port, LIVEKIT_WEBHOOK_CONTENT_TYPE);

    expect(result.rawBodyLength).toBeNull();
  });

  it('con createApp() (la configuración real del bootstrap), application/webhook+json llega con rawBody no vacío', async () => {
    const app = await createApp(RawBodyProbeModule);
    const port = await listenOnEphemeralPort(app);

    const result = await postProbe(port, LIVEKIT_WEBHOOK_CONTENT_TYPE);

    expect(result.rawBodyLength).not.toBeNull();
    expect(result.rawBodyLength).toBeGreaterThan(0);
  });

  it('[regresión] una ruta JSON existente (GET /health) responde igual con rawBody:true activado', async () => {
    @Module({ controllers: [AppController] })
    class HealthOnlyModule {}

    const app = await createApp(HealthOnlyModule);
    const port = await listenOnEphemeralPort(app);

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'ok' });
  });
});

@Controller()
class FailingController {
  @Get('boom')
  boom() {
    throw new Error('Failed query: select "password_hash" from "users"');
  }
}

@Module({ controllers: [FailingController] })
class FailingModule {}

describe('bootstrap: R7 (errores y CORS)', () => {
  it('createApp() falla al arrancar si CORS_ORIGIN falta', async () => {
    vi.stubEnv('CORS_ORIGIN', '');

    await expect(createApp(FailingModule)).rejects.toThrow(/CORS_ORIGIN/);
  });

  it('un error inesperado responde 500 genérico sin filtrar SQL', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const app = await createApp(FailingModule);
    const port = await listenOnEphemeralPort(app);

    const response = await fetch(`http://127.0.0.1:${port}/boom`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ statusCode: 500, message: 'Internal server error' });
  });

  it('CORS responde solo con el origen configurado, no con *', async () => {
    const app = await createApp(FailingModule);
    const port = await listenOnEphemeralPort(app);

    const response = await fetch(`http://127.0.0.1:${port}/boom`, {
      headers: { Origin: 'http://localhost:3002' },
    });

    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3002');
  });

  it('un body JSON mayor al límite responde 413 genérico (no 500)', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const app = await createApp(RawBodyProbeModule);
    const port = await listenOnEphemeralPort(app);

    const response = await fetch(`http://127.0.0.1:${port}/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blob: 'x'.repeat(200 * 1024) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ statusCode: 413, message: 'Payload Too Large' });
  });
});
