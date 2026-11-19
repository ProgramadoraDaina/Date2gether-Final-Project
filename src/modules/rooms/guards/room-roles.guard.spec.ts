import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { RoomRole } from '../../../db/schema';
import type { RoomsService } from '../rooms.service';
import { RoomRolesGuard } from './room-roles.guard';

const httpContext = (request: object) =>
  ({
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const request = {
  params: { code: 'abc-defg-hij' },
  user: { sub: 'user-1', email: 'a@example.test' },
};

function buildGuard(memberRole: RoomRole | undefined, allowedRoles: RoomRole[] | undefined) {
  const roomsService = {
    getMemberRole: jest.fn<RoomsService['getMemberRole']>().mockResolvedValue(memberRole),
  };
  const reflector = { get: jest.fn().mockReturnValue(allowedRoles) } as unknown as Reflector;
  return new RoomRolesGuard(roomsService as unknown as RoomsService, reflector);
}

describe('RoomRolesGuard', () => {
  it('rechaza a quien no es miembro de la sala', async () => {
    const guard = buildGuard(undefined, undefined);

    await expect(guard.canActivate(httpContext(request))).rejects.toThrow(ForbiddenException);
  });

  it('rechaza si el rol de quien llama no está en la lista de roles permitidos', async () => {
    const guard = buildGuard('participante', ['administrador']);

    await expect(guard.canActivate(httpContext(request))).rejects.toThrow(ForbiddenException);
  });

  it('permite si el rol de quien llama está en la lista de roles permitidos', async () => {
    const guard = buildGuard('administrador', ['administrador']);

    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
  });

  it('permite a cualquier miembro cuando el endpoint no restringe roles', async () => {
    const guard = buildGuard('participante', undefined);

    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
  });
});
