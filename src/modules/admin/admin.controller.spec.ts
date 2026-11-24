import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { AdminController } from './admin.controller';
import type { AdminService } from './admin.service';

describe('AdminController', () => {
  it('protege todo el controlador con JWT + RolesGuard y exige el rol admin', () => {
    expect(Reflect.getMetadata('__guards__', AdminController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toEqual(['admin']);
  });

  it('PATCH /admin/users/:id/role pasa el id de quien llama para frenar la auto-degradación', async () => {
    const adminService = { setUserRole: vi.fn().mockResolvedValue({ id: 'user-2' }) };
    const controller = new AdminController(adminService as unknown as AdminService);

    await controller.setUserRole(
      'b4f3c0a2-1111-4222-8333-444455556666',
      { role: 'admin' },
      { sub: 'actor-1', email: 'a@example.test' },
    );

    expect(adminService.setUserRole).toHaveBeenCalledWith(
      'actor-1',
      'b4f3c0a2-1111-4222-8333-444455556666',
      'admin',
    );
  });

  it('DELETE /admin/rooms/:code responde 204 y delega en AdminService', async () => {
    const adminService = { deleteRoom: vi.fn().mockResolvedValue(undefined) };
    const controller = new AdminController(adminService as unknown as AdminService);
    const handler = Object.getOwnPropertyDescriptor(AdminController.prototype, 'deleteRoom')!
      .value as object;

    await expect(controller.deleteRoom('abc-defg-hij')).resolves.toBeUndefined();

    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(204);
    expect(adminService.deleteRoom).toHaveBeenCalledWith('abc-defg-hij');
  });
});
