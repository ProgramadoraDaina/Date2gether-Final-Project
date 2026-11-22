import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Deviación aditiva sobre design.md (apply-progress Fase 5): el contrato
// abreviado de selfReturn() no modela a QUIÉN devuelve un administrador
// cuando no es a sí mismo (spec breakout-rooms/admin-devuelve). Un ocupante
// que vuelve por cuenta propia manda el body vacío; un administrador que
// fuerza el retorno de otro ocupante indica su identity.
export class ReturnOccupantDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  livekitIdentity?: string;
}
