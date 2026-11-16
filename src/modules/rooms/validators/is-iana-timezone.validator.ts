import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// BUG EVITADO (dos capas, cada una necesaria):
//
// 1. Intl.supportedValuesOf('timeZone') (418 zonas en este runtime, Node 24
//    con ICU completo) devuelve solo nombres CANÓNICOS -- excluye alias
//    legítimos que Intl.DateTimeFormat sí acepta y resuelve, como "UTC"
//    (alias de "Etc/UTC") y "America/Argentina/Buenos_Aires" (alias de
//    "America/Buenos_Aires"). Un Set contra esa lista rechazaría ambos,
//    falsos negativos reales. Construir el formatter y capturar el
//    RangeError acepta los alias -- es la misma vía que se usa para
//    formatear después (design.md D6).
// 2. Pero Intl.DateTimeFormat TAMBIÉN acepta un offset numérico como
//    timeZone (p. ej. "-03:00", propuesta ECMA-402 de zonas de offset
//    fijo) -- válido para el motor, pero exactamente lo que la spec
//    prohíbe ("nunca un offset numérico"): un offset fijo no sigue reglas
//    de DST y rompe el propósito de guardar una zona real. Se rechaza
//    explícitamente cualquier valor que empiece con signo + dígito.
const NUMERIC_OFFSET_PATTERN = /^[+-]\d/;

@ValidatorConstraint({ name: 'isIanaTimezone' })
export class IsIanaTimezoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !value) return false;
    if (NUMERIC_OFFSET_PATTERN.test(value)) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} debe ser un nombre de zona horaria IANA válido (p. ej. "America/Argentina/Buenos_Aires")`;
  }
}

export function IsIanaTimezone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsIanaTimezoneConstraint,
    });
  };
}
