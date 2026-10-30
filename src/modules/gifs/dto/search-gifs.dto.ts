import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SearchGifsDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(50)
  q?: string;

  // GIPHY rechaza offsets mayores a 4999.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4999)
  offset?: number;
}
