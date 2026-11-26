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

  // Set at creation. Afterwards it can only go false -> true, through the admin
  // promote endpoint (D5/D7 revised, see decision 30). Defaults to false when omitted.
  @IsOptional()
  @IsBoolean()
  isPermanent?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateScheduleSlotDto)
  slots?: CreateScheduleSlotDto[];
}
