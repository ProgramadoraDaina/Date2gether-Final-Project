import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminService } from './admin.service';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ACCESS_TOKEN_AUTH } from '../../swagger';

@ApiTags('Admin')
@ApiBearerAuth(ACCESS_TOKEN_AUTH)
@ApiUnauthorizedResponse({ description: 'Missing, invalid or expired access token' })
@ApiForbiddenResponse({ description: 'Account role is not admin' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @ApiOperation({ summary: 'List all accounts', description: 'Requires global role: admin.' })
  @Get('users')
  listUsers() {
    return this.adminService.listUsers();
  }

  @ApiOperation({
    summary: 'Change the global role of an account',
    description: 'Requires global role: admin. An admin cannot remove their own admin role.',
  })
  @ApiBadRequestResponse({
    description: 'Validation failed, or the admin tried to demote themselves',
  })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @Patch('users/:id/role')
  setUserRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    return this.adminService.setUserRole(actor.sub, id, dto.role);
  }

  @ApiOperation({ summary: 'Delete any room by code', description: 'Requires global role: admin.' })
  @ApiNotFoundResponse({ description: 'Room not found' })
  @Delete('rooms/:code')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRoom(@Param('code') code: string): Promise<void> {
    await this.adminService.deleteRoom(code);
  }
}
