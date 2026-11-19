import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AccessTokenPayload } from '../auth.types';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AccessTokenPayload => {
    // JwtAuthGuard siempre corre antes y deja request.user seteado.
    return ctx.switchToHttp().getRequest<Request>().user!;
  },
);
