import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// ThrottlerGuard asume un contexto HTTP (lee/escribe headers en `res`). En un
// contexto que no sea HTTP (ej. los gateways de WebSocket de ChatGateway),
// `res` llega undefined y setResponseHeader revienta con un TypeError no
// capturado por los tests unitarios de los handlers (esos llaman al método
// directamente, sin pasar por el pipeline de guards de Nest). Se salta
// cualquier contexto que no sea HTTP en vez de limitarlo.
@Injectable()
export class HttpOnlyThrottlerGuard extends ThrottlerGuard {
  protected shouldSkip(context: ExecutionContext): Promise<boolean> {
    return Promise.resolve(context.getType() !== 'http');
  }
}
