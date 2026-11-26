import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';

type IoServerOptions = Parameters<IoAdapter['createIOServer']>[1];

/**
 * Applies the CORS origin to every Socket.IO server at runtime. The
 * @WebSocketGateway decorator is evaluated at import time, before ConfigModule
 * has loaded .env, so it cannot read CORS_ORIGIN reliably.
 */
export class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origin: string,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: IoServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origin },
    } as IoServerOptions);
  }
}
