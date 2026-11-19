import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { RoomRole } from '../../../db/schema';
import type { AccessTokenPayload } from '../../auth/auth.types';
import { ROOM_ROLES_KEY } from '../decorators/room-roles.decorator';
import { RoomsService } from '../rooms.service';

@Injectable()
export class RoomRolesGuard implements CanActivate {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedRoles =
      this.reflector.get<RoomRole[] | undefined>(ROOM_ROLES_KEY, context.getHandler()) ?? [];
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AccessTokenPayload;

    const role = await this.roomsService.getMemberRole(request.params.code as string, user.sub);
    if (!role) {
      throw new ForbiddenException('No sos parte de esta sala');
    }
    if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
      throw new ForbiddenException('Tu rol en la sala no permite esta acción');
    }
    return true;
  }
}
