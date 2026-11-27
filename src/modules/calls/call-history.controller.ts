import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CallsService } from './calls.service';
import { ListCallHistoryDto } from './dto/list-call-history.dto';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ACCESS_TOKEN_AUTH } from '../../swagger';

// Controlador separado (en vez de agregar la ruta al CallsController) porque
// los guards de Nest se acumulan: no se puede "reemplazar" el RoomAccessGuard
// de nivel controller con un guard distinto a nivel método, ambos correrían.
// Esta ruta es exclusiva de cuentas registradas, por eso usa JwtAuthGuard.
@ApiTags('Call history')
@ApiBearerAuth(ACCESS_TOKEN_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallHistoryController {
  constructor(private readonly callsService: CallsService) {}

  @ApiOperation({ summary: 'List the call history of the authenticated account' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @Get('history')
  list(@CurrentUser() user: AccessTokenPayload, @Query() query: ListCallHistoryDto) {
    return this.callsService.listHistory(user.sub, query);
  }

  @ApiOperation({ summary: 'Clear the call history archive of the authenticated account' })
  @Delete('history/archive')
  @HttpCode(204)
  async clearArchive(@CurrentUser() user: AccessTokenPayload) {
    await this.callsService.clearHistoryArchive(user.sub);
  }

  // Las notas propias (personales) no pasan por acá: viven solo en
  // localStorage del dispositivo donde se escribieron (ver RoomPage).
  // :roomId, no :roomCode (D4-C) -- el código recicla, el id no.
  @ApiOperation({ summary: 'Get the shared notes of a room from the history' })
  @ApiNotFoundResponse({ description: 'Room not found, or not in the account history' })
  @Get('history/:roomId/notes')
  notes(@CurrentUser() user: AccessTokenPayload, @Param('roomId', ParseUUIDPipe) roomId: string) {
    return this.callsService.getRoomNotesForHistory(user.sub, roomId);
  }
}
