import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AccessTokenPayload } from '../../auth/auth.types';
import { RoomsService } from '../rooms.service';

@Injectable()
export class RoomAdminGuard implements CanActivate {
  constructor(private readonly roomsService: RoomsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AccessTokenPayload;
    const code = request.params.code as string;

    const role = await this.roomsService.getMemberRole(code, user.sub);
    if (role !== 'administrador') {
      throw new ForbiddenException('Solo el administrador de la sala puede hacer esto');
    }
    return true;
  }
}
