import { Controller, HttpCode, Post, Req, type RawBodyRequest } from '@nestjs/common';
// WORKAROUND DE ENTORNO (no es una preferencia de estilo): bajo el modo ESM
// de Jest de este proyecto, cualquier módulo que importe en tiempo de
// ejecución tanto @nestjs/common como el índice de @nestjs/throttler (que
// re-exporta su decorador real, el cual a su vez vuelve a requerir
// @nestjs/common) dispara "Cannot require() ES Module ... in a cycle" — el
// mismo bug de entorno ya documentado en PR1 para AppModule (ver
// state.yaml, sección deviations_from_design). Reproducido en aislado con
// una probe spec descartable: CUALQUIER archivo que combine ambos imports
// de valor en tiempo de ejecución falla, sin importar el orden ni si es el
// propio spec u otro módulo el que los combina. Este controller SÍ necesita
// @nestjs/common (los decoradores @Controller/@Post/@HttpCode), así que no
// puede además importar el índice de @nestjs/throttler.
// Se importa SOLO la constante desde su archivo real (sin pasar por
// throttler.decorator.ts, que es el que requiere @nestjs/common), y se
// escribe a mano la MISMA metadata que @SkipThrottle() define — es lo único
// que lee el guard global (ThrottlerGuard, registrado vía APP_GUARD en
// app.module.ts, leído vía Reflector). Verificado
// contra @nestjs/throttler@6.7.1: ver throttler.decorator.js,
// `SkipThrottle = (skip = { default: true }) => ... Reflect.defineMetadata(THROTTLER_SKIP + key, ...)`.
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants.js';
import type { Request } from 'express';
import { CallsWebhookService } from './calls-webhook.service';

function skipGlobalThrottle(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(`${THROTTLER_SKIP}default`, true, target);
  };
}

// Clase propia, separada de CallsController/CallHistoryController: los
// guards de Nest se acumulan a nivel clase, así que la única forma de que
// esta ruta quede sin NINGÚN guard es que no extienda ni comparta clase con
// un controller que ya tenga uno (ver comentario de CallHistoryController).
// skipGlobalThrottle() (equivalente a @SkipThrottle(), ver nota arriba)
// porque el ThrottlerGuard global (app.module.ts) es 60 req/min/IP y LiveKit pega
// desde una sola IP: cerrar una sala de 6 personas puede generar ~19 eventos
// seguidos.
@Controller('calls/livekit')
@skipGlobalThrottle()
export class CallsWebhookController {
  constructor(private readonly webhookService: CallsWebhookService) {}

  @Post('webhook')
  // 200 siempre que la firma sea válida y el evento quede persistido —
  // responder distinto haría que LiveKit reintente y re-ejecute efectos.
  @HttpCode(200)
  async handle(@Req() req: RawBodyRequest<Request>): Promise<void> {
    // Solo @Req(): el ValidationPipe global usa forbidNonWhitelisted: true y
    // rechazaría el payload real de LiveKit si se leyera con @Body().
    const authHeader = req.headers.authorize;
    await this.webhookService.handle(
      req.rawBody,
      Array.isArray(authHeader) ? authHeader[0] : authHeader,
    );
  }
}
