import { ArrayUnique, IsArray, IsInt, Min } from 'class-validator';

// Array vacío = retirar el voto; el gateway valida por separado que los
// índices entren en el rango de opciones y respeten multipleChoice (eso
// depende del estado de la encuesta, no se puede expresar en el DTO).
export class CastPollVoteDto {
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  optionIndexes: number[];
}
