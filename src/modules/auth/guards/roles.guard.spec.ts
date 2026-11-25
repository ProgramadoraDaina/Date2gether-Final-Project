import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { DrizzleDb } from '../../../db/drizzle.module';
import type { UserRole } from '../../../db/schema';
import { chain, createFakeDb } from '../../../test-support/fake-drizzle';
import { RolesGuard } from './roles.guard';

const httpContext = (request: object) =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const authenticated = { user: { sub: 'user-1', email: 'a@example.test' } };

function buildGuard(accountRole: UserRole | undefined, allowedRoles: UserRole[] | undefined) {
  const db = createFakeDb();
  db.select.mockReturnValue(chain(accountRole ? [{ role: accountRole }] : []));
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(allowedRoles),
  } as unknown as Reflector;
  return { guard: new RolesGuard(db as unknown as DrizzleDb, reflector), db };
}

describe('RolesGuard', () => {
  it('permite a una cuenta admin en un endpoint exclusivo de admin', async () => {
    const { guard } = buildGuard('admin', ['admin']);

    await expect(guard.canActivate(httpContext(authenticated))).resolves.toBe(true);
  });

  it('responde 403 si la cuenta tiene rol user en un endpoint exclusivo de admin', async () => {
    const { guard } = buildGuard('user', ['admin']);

    await expect(guard.canActivate(httpContext(authenticated))).rejects.toThrow(ForbiddenException);
  });

  it('responde 401 si no hay usuario autenticado en la request', async () => {
    const { guard, db } = buildGuard('admin', ['admin']);

    await expect(guard.canActivate(httpContext({}))).rejects.toThrow(UnauthorizedException);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('responde 401 si la cuenta ya no existe aunque el token siga vigente', async () => {
    const { guard } = buildGuard(undefined, ['admin']);

    await expect(guard.canActivate(httpContext(authenticated))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('sin @Roles alcanza con estar autenticado, sin consultar la base', async () => {
    const { guard, db } = buildGuard('user', undefined);

    await expect(guard.canActivate(httpContext(authenticated))).resolves.toBe(true);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('lee el rol de la base en cada request: un descenso de rol aplica de inmediato', async () => {
    const { guard, db } = buildGuard('admin', ['admin']);
    await expect(guard.canActivate(httpContext(authenticated))).resolves.toBe(true);

    db.select.mockReturnValue(chain([{ role: 'user' }]));

    await expect(guard.canActivate(httpContext(authenticated))).rejects.toThrow(ForbiddenException);
  });
});
