import { afterEach, describe, expect, it } from '@jest/globals';
import { Controller, Module, Post, Req, type RawBodyRequest } from '@nestjs/common';
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

afterEach(async () => {
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
