import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../../db/schema';

export const ROLES_KEY = 'globalRoles';

// Rol GLOBAL de la cuenta (users.role). No confundir con @RoomRoles, que es por sala.
// Sin roles = cualquier cuenta autenticada alcanza.
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
