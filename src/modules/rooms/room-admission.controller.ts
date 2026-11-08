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

@Controller('rooms/:code')
export class RoomAdmissionController {
  constructor(
    private readonly admission: RoomAdmissionService,
    private readonly access: RoomAccessService,
  ) {}

  @Header('Cache-Control', 'no-store')
  @Post('access')
  request(
    @Param('code') code: string,
    @Body() dto: RoomAccessDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.admission.request(code, dto.name, authorization);
  }

  @Header('Cache-Control', 'no-store')
  @Get('admission/:id/status')
  status(
    @Param('code') code: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.admission.status(code, id, this.access.bearer(authorization));
  }

  @Post('admission/:id/cancel')
  cancel(
    @Param('code') code: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.admission.cancel(code, id, this.access.bearer(authorization));
  }

  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Header('Cache-Control', 'no-store')
  @Get('admission')
  list(@Param('code') code: string) {
    return this.admission.list(code);
  }

  @UseGuards(JwtAuthGuard, RoomRolesGuard)
  @RoomRoles('administrador')
  @Patch('admission')
  configure(@Param('code') code: string, @Body() dto: UpdateAdmissionSettingsDto) {
    return this.admission.configure(code, dto);
  }

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
