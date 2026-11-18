import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateScheduleSlotDto } from './create-schedule-slot.dto';

export class CreateRoomDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  // Immutable in v1 (D5): absent from every update DTO, no endpoint accepts
  // it afterwards. Defaults to false when omitted.
  @IsOptional()
  @IsBoolean()
  isPermanent?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateScheduleSlotDto)
  slots?: CreateScheduleSlotDto[];
}
