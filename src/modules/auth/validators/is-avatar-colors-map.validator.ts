import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  AVATAR_BODY_IDS,
  AVATAR_COLOR_PATTERN,
  AVATAR_FACE_IDS,
  AVATAR_HEAD_IDS,
  AVATAR_NECK_IDS,
  AVATAR_SLOTS,
  type AvatarSlot,
} from '../avatar';

const IDS_BY_SLOT: Record<AvatarSlot, readonly string[]> = {
  body: AVATAR_BODY_IDS,
  head: AVATAR_HEAD_IDS,
  face: AVATAR_FACE_IDS,
  neck: AVATAR_NECK_IDS,
};

function isAvatarSlot(value: string): value is AvatarSlot {
  return (AVATAR_SLOTS as readonly string[]).includes(value);
}

// colors llega como mapa "<slot>:<id>" -> color hex: cada pieza seleccionada
// tiene su propio color, no uno solo por slot (ver avatarColorKey en
// ../avatar.ts). Se valida acá en vez de con una DTO anidada porque las
// claves son dinámicas (dependen de qué piezas eligió la persona).
@ValidatorConstraint({ name: 'isAvatarColorsMap' })
export class IsAvatarColorsMapConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined) return true;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    return Object.entries(value as Record<string, unknown>).every(([key, color]) => {
      const [slot, id] = key.split(':');
      if (!slot || !id || !isAvatarSlot(slot)) return false;
      if (!IDS_BY_SLOT[slot].includes(id)) return false;
      return typeof color === 'string' && AVATAR_COLOR_PATTERN.test(color);
    });
  }

  defaultMessage(): string {
    return 'colors debe ser un mapa "<slot>:<id>" a color hex de una pieza del catálogo';
  }
}

export function IsAvatarColorsMap(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsAvatarColorsMapConstraint,
    });
  };
}
