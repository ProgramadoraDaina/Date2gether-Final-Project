import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SaveTranscriptLineDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  callSid!: string;

  // Mismo tope que el cliente aplica a cada frase de los subtítulos.
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  content!: string;
}

export class GetTranscriptDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  callSid!: string;
}
