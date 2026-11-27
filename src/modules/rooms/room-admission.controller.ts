import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoomAccessService } from '../auth/room-access.service';
import { RoomRoles } from './decorators/room-roles.decorator';
import { RoomRolesGuard } from './guards/room-roles.guard';
import { RoomAccessDto } from './dto/room-access.dto';
import { AdmissionDecisionDto, UpdateAdmissionSettingsDto } from './dto/update-admission.dto';
import { RoomAdmissionService } from './room-admission.service';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ACCESS_TOKEN_AUTH, ROOM_PASS_AUTH } from '../../swagger';

@ApiTags('Room admission')
@Controller('rooms/:code')
export class RoomAdmissionController {
  constructor(
    private readonly admission: RoomAdmissionService,
    private readonly access: RoomAccessService,
  ) {}

  @ApiOperation({
    summary: 'Request access to a room and get a room pass or admission ticket',
    description:
      'Public. Guests send a display name; sending an account access token links the pass to the account. Returns a room pass when entry is open (or the account is administrador), otherwise a pending admission request with a ticket.',
  })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Account token was sent but is invalid or expired' })
  @ApiForbiddenResponse({
    description: 'Room is locked for new entries, or the account was kicked',
  })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @Header('Cache-Control', 'no-store')
  @Post('access')
  request(
    @Param('code') code: string,
    @Body() dto: RoomAccessDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.admission.request(code, dto.name, authorization);
  }

  @ApiOperation({
    summary: 'Poll the status of an admission request',
    description: 'Send the admission ticket as Bearer token (room-pass scheme).',
  })
  @ApiBearerAuth(ROOM_PASS_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admission ticket' })
  @ApiNotFoundResponse({ description: 'Request not found or expired' })
  @ApiBadRequestResponse({ description: 'Invalid request id' })
  @Header('Cache-Control', 'no-store')
  @Get('admission/:id/status')
  status(
    @Param('code') code: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.admission.status(code, id, this.access.bearer(authorization));
  }

  @ApiOperation({
    summary: 'Cancel an own admission request',
    description: 'Send the admission ticket as Bearer token (room-pass scheme).',
  })
  @ApiBearerAuth(ROOM_PASS_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admission ticket' })
  @ApiNotFoundResponse({ description: 'Request not found or expired' })
  @ApiBadRequestResponse({ description: 'Invalid request id' })
  @Post('admission/:id/cancel')
  cancel(
    @Param('code') code: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.admission.cancel(code, id, this.access.bearer(authorization));
  }

  @ApiOperation({
    summary: 'List pending admission requests',
    description: 'Requires room role: administrador.',
  })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Not a member of the room, or room role not allowed (requires: administrador)',
  })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Header('Cache-Control', 'no-store')
  @Get('admission')
  list(@Param('code') code: string) {
    return this.admission.list(code);
  }

  @ApiOperation({
    summary: 'Configure the waiting room and entry lock',
    description: 'Requires room role: administrador.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Not a member of the room, or room role not allowed (requires: administrador)',
  })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Patch('admission')
  configure(@Param('code') code: string, @Body() dto: UpdateAdmissionSettingsDto) {
    return this.admission.configure(code, dto);
  }

  @ApiOperation({
    summary: 'Admit or reject an admission request',
    description: 'Requires room role: administrador.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Request expired or already resolved' })
  @ApiBearerAuth(ACCESS_TOKEN_AUTH)
  @ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
  @ApiForbiddenResponse({
    description: 'Not a member of the room, or room role not allowed (requires: administrador)',
  })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Patch('admission/:id')
  decide(
    @Param('code') code: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdmissionDecisionDto,
  ) {
    return this.admission.decide(code, id, dto.decision);
  }
}
