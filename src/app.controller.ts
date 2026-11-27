import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller()
export class AppController {
  // Endpoint simple para comprobar que el servidor está arriba: lo usa
  // Playwright para saber cuándo arrancar los tests, y sirve igual para
  // un healthcheck de Docker o de un load balancer más adelante.
  @ApiOperation({ summary: 'Liveness check' })
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
