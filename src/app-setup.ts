import { ValidationPipe, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

// Content-Type que usa LiveKit para sus webhooks. El parser JSON de Express
// por defecto solo atiende 'application/json': sin declarar este tipo
// explícitamente, req.rawBody llegaría vacío y la verificación HMAC del
// webhook fallaría siempre (gotcha documentado en design.md D6).
const LIVEKIT_WEBHOOK_CONTENT_TYPE = 'application/webhook+json';

/**
 * Crea y configura la app Nest. Separado de main.ts para poder reusar
 * exactamente esta misma configuración en los tests de integración del
 * bootstrap (ver src/app-setup.spec.ts), inyectando un módulo de prueba en
 * lugar de AppModule.
 *
 * Nota deliberada: este archivo NO importa AppModule (a diferencia de la
 * versión anterior de main.ts). Hacerlo rompía los tests: bajo el modo ESM
 * de Jest de este proyecto, importar AppModule dispara un ciclo real de
 * require() dentro de @nestjs/throttler (ThrottlerModule), un bug latente
 * del entorno de test que nadie había pisado porque ningún spec importaba
 * AppModule directamente antes de este cambio. Por eso el módulo a bootstrapear
 * es un parámetro obligatorio: quien quiera levantar la API real (main.ts)
 * importa y pasa AppModule explícitamente; los tests pasan un módulo mínimo.
 */
export async function createApp(module: Type<unknown>): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(module, { rawBody: true });

  // rawBody: true es aditivo: Nest sigue parseando JSON como siempre y solo
  // además retiene el buffer crudo. Esta línea extiende qué Content-Type
  // dispara ese parseo para que también cubra el de LiveKit.
  app.useBodyParser('json', { type: ['application/json', LIVEKIT_WEBHOOK_CONTENT_TYPE] });

  app.use(
    helmet({
      // API consumida desde otro origen (frontend en :3002): sin esto, el navegador
      // bloquea la lectura de las respuestas por Cross-Origin-Resource-Policy.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? '*' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  return app;
}
