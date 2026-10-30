import { describe, expect, it } from '@jest/globals';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ROOM_ROLES_KEY } from '../rooms/decorators/room-roles.decorator';
import { RoomRolesGuard } from '../rooms/guards/room-roles.guard';
import { RoomEmojisController } from './room-emojis.controller';

function handler(name: keyof RoomEmojisController): object {
  return Object.getOwnPropertyDescriptor(RoomEmojisController.prototype, name)!.value as object;
}

describe('RoomEmojisController', () => {
  it.each(['create', 'remove'] as const)(
    '%s exige cuenta autenticada y luego el rol de la sala, en ese orden',
    (name) => {
      expect(Reflect.getMetadata('__guards__', handler(name))).toEqual([
        JwtAuthGuard,
        RoomRolesGuard,
      ]);
    },
  );

  it.each(['create', 'remove'] as const)(
    '%s solo lo permite a administrador y colaborador',
    (name) => {
      expect(Reflect.getMetadata(ROOM_ROLES_KEY, handler(name))).toEqual([
        'administrador',
        'colaborador',
      ]);
    },
  );

  it('borrar responde 204 sin cuerpo', () => {
    expect(Reflect.getMetadata('__httpCode__', handler('remove'))).toBe(204);
  });
});
