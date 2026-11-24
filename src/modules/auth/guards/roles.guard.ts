import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DRIZZLE, type DrizzleDb } from '../../../db/drizzle.module';
import { users, type UserRole } from '../../../db/schema';
import { ROLES_KEY } from '../decorators/roles.decorator';

// Debe correr después de JwtAuthGuard (necesita request.user). El rol se lee de la base en
// cada request, no del JWT: así un descenso de rol tiene efecto inmediato y no al vencer el token.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedRoles =
      this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('Token de acceso requerido');
    }
    if (allowedRoles.length === 0) return true;

    const [account] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    // Cuenta borrada con un token todavía vigente: no hay sesión válida.
    if (!account) {
      throw new UnauthorizedException('Usuario no encontrado');
    }
    if (!allowedRoles.includes(account.role)) {
      throw new ForbiddenException('Tu rol no permite esta acción');
    }
    return true;
  }
}
