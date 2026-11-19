import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CallsService } from './calls.service';

// Controlador separado (en vez de agregar la ruta al CallsController) porque
// los guards de Nest se acumulan: no se puede "reemplazar" el RoomAccessGuard
// de nivel controller con un guard distinto a nivel método, ambos correrían.
// Esta ruta es exclusiva de cuentas registradas, por eso usa JwtAuthGuard.
@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallHistoryController {
  constructor(private readonly callsService: CallsService) {}

  @Get('history')
  list(@CurrentUser() user: AccessTokenPayload) {
    return this.callsService.listHistory(user.sub);
  }

  // Las notas propias (personales) no pasan por acá: viven solo en
  // localStorage del dispositivo donde se escribieron (ver RoomPage).
  // :roomId, no :roomCode (D4-C) -- el código recicla, el id no.
  @Get('history/:roomId/notes')
  notes(@CurrentUser() user: AccessTokenPayload, @Param('roomId', ParseUUIDPipe) roomId: string) {
    return this.callsService.getRoomNotesForHistory(user.sub, roomId);
  }
}
