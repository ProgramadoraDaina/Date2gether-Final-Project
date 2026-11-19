import { SetMetadata } from '@nestjs/common';
import type { RoomRole } from '../../../db/schema';

export const ROOM_ROLES_KEY = 'roomRoles';

// Sin roles = alcanza con ser miembro de la sala.
export const RoomRoles = (...roles: RoomRole[]) => SetMetadata(ROOM_ROLES_KEY, roles);
