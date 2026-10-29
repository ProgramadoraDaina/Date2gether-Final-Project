import { describe, expect, it, jest } from '@jest/globals';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthService } from './auth.service';

describe('AuthController', () => {
  it('requiere autenticación para leer y actualizar el perfil propio', () => {
    for (const method of ['me', 'updateNameColor']) {
      const handler = Object.getOwnPropertyDescriptor(AuthController.prototype, method)!
        .value as object;
      const guards = (Reflect.getMetadata('__guards__', handler) ?? []) as unknown[];
      expect(guards).toContain(JwtAuthGuard);
    }
  });

  it('delega la actualización de color en AuthService con el id del usuario autenticado', async () => {
    const updatedUser = { id: 'user-1', nameColor: 'teal' };
    const service = {
      updateNameColor: jest
        .fn<AuthService['updateNameColor']>()
        .mockResolvedValue(updatedUser as never),
    };
    const controller = new AuthController(service as unknown as AuthService);

    const result = await controller.updateNameColor(
      { sub: 'user-1', email: 'a@example.test' },
      { nameColor: 'teal' },
    );

    expect(result).toEqual(updatedUser);
    expect(service.updateNameColor).toHaveBeenCalledWith('user-1', 'teal');
  });
});
