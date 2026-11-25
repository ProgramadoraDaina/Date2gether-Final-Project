import { ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class RecallBreakoutRoomsDto {
  // Sin breakoutIds = todas las mini salas abiertas.
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  breakoutIds?: string[];

  @IsInt()
  @Min(5)
  @Max(600)
  inSeconds!: number;
}
