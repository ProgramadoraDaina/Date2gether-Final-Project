import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoomServiceClient } from 'livekit-server-sdk';
import { ApiExcludeController } from '@nestjs/swagger';

// Endpoint exclusivo de la suite E2E (Fase 7, tasks.md 7.1): expone
// listParticipants de LiveKit por nombre de sala para verificar el
// aislamiento entre mini salas usando el MISMO mecanismo server-side que ya
// usan CallsService.assertHostConnected/CallSessionCloseService.hasConnectedAdmin
// en producción (design.md D2/D3), en vez de inspeccionar tracks de WebRTC
// desde el navegador (sin precedente en este repo, ver tasks.md 7.1).
//
// Gateado por NODE_ENV==='test': 404 en cualquier otro entorno (dev,
// producción). No reutiliza RoomAccessGuard porque esta ruta no pertenece a
// ninguna sala concreta ni a ningún participante: es pura introspección de
// LiveKit para la suite, nunca debe quedar accesible fuera de ella.
@ApiExcludeController()
@Controller('test-support')
export class TestSupportController {
  constructor(private readonly config: ConfigService) {}

  @Get('livekit-rooms/:roomName/participants')
  async listParticipants(@Param('roomName') roomName: string): Promise<{ identities: string[] }> {
    if (process.env.NODE_ENV !== 'test') {
      throw new NotFoundException();
    }
    const url = this.config.get<string>('LIVEKIT_URL');
    const apiKey = this.config.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET');
    if (!url || !apiKey || !apiSecret) return { identities: [] };

    const apiUrl = this.config.get<string>('LIVEKIT_API_URL') || url.replace(/^ws/, 'http');
    const client = new RoomServiceClient(apiUrl, apiKey, apiSecret);
    try {
      const participants = await client.listParticipants(roomName);
      return {
        identities: participants
          .map((participant) => participant.identity)
          .filter((identity): identity is string => !!identity),
      };
    } catch {
      // La sala puede no existir todavía (nadie se conectó) o ya haber sido
      // reapeada por LiveKit: mismo criterio fail-soft que el resto de los
      // consumidores de listParticipants en este módulo (ver calls.service.ts).
      return { identities: [] };
    }
  }
}
