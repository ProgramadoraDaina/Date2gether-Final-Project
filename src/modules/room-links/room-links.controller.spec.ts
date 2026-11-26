import { describe, expect, it } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoomAccessGuard } from '../auth/guards/room-access.guard';
import { ROOM_ROLES_KEY } from '../rooms/decorators/room-roles.decorator';
import { RoomRolesGuard } from '../rooms/guards/room-roles.guard';
import { RoomLinksController } from './room-links.controller';

const handler = (name: 'list' | 'add' | 'remove') => RoomLinksController.prototype[name];

describe('RoomLinksController: permisos', () => {
  it('leer pide solo el token de la sala (invitados incluidos)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler('list'))).toEqual([RoomAccessGuard]);
  });

  it.each(['add', 'remove'] as const)(
    '%s exige cuenta y rol administrador o colaborador',
    (name) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler(name))).toEqual([
        JwtAuthGuard,
        RoomRolesGuard,
      ]);
      expect(Reflect.getMetadata(ROOM_ROLES_KEY, handler(name))).toEqual([
        'administrador',
        'colaborador',
      ]);
    },
  );
});
